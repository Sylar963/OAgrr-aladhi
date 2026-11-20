import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getAdapter, PremiumSpikeRuntime, type PremiumSpikeHistory } from '@oggregator/core';
import {
  PremiumSpikeHistorySchema,
  PremiumSpikeQuerySchema,
  PremiumSpikeResponseSchema,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { createExpiryChainSource } from '../alpha-expiry-chains.js';

export function premiumSpikeHistory(path: string): PremiumSpikeHistory {
  return {
    async load() {
      try {
        return PremiumSpikeHistorySchema.parse(JSON.parse(await readFile(path, 'utf8')));
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
        throw err;
      }
    },
    async save(states) {
      await mkdir(dirname(path), { recursive: true });
      const text = JSON.stringify(PremiumSpikeHistorySchema.parse(states));
      await writeFile(`${path}.tmp`, text, 'utf8');
      await rename(`${path}.tmp`, path);
    },
  };
}

export async function premiumSpikesRoute(app: FastifyInstance) {
  const chains = createExpiryChainSource(app, 'Premium spikes');
  const runtime = new PremiumSpikeRuntime({
    log: app.log,
    history: premiumSpikeHistory(
      process.env['PREMIUM_SPIKE_CACHE_PATH'] ?? '.cache/premium-spikes.json',
    ),
    source: {
      async expiries(query) {
        const adapter = getAdapter(query.venue);
        const dates = await adapter.listExpiries(query.underlying);
        const times = (await adapter.listExpiryTimestamps?.(query.underlying)) ?? [];
        return dates.map((expiry) => ({
          expiry,
          expiryTs: times.find((t) => t.expiry === expiry)?.expiryTs ?? null,
        }));
      },
      async chains(query, expiries) {
        const plans = [{ venue: query.venue, expiries, error: null }];
        await chains.syncSubscriptions(plans, query.underlying, Date.now());
        const result = await chains.fetchChains(plans, query.underlying, app.log);
        if (plans[0]?.error && result.length === 0) throw new Error(plans[0].error);
        return result.map((entry) => entry.chain);
      },
    },
  });
  app.addHook('onReady', () => runtime.start());
  app.addHook('onClose', () => runtime.dispose());
  app.get('/premium-spikes', async (req, reply) => {
    const query = PremiumSpikeQuerySchema.safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() });
    try {
      return PremiumSpikeResponseSchema.parse(runtime.watch(query.data));
    } catch (err: unknown) {
      return reply
        .status(429)
        .send({ error: err instanceof Error ? err.message : 'Monitor unavailable' });
    }
  });
}
