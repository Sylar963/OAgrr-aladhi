import { TradfiAnalyticsResponseSchema, TradfiParityResponseSchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TradfiDeps } from '../app.js';
import { buildAnalytics, buildParity, liveExpiries } from '../runtime/analytics.js';

const Query = z.object({
  underlying: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((s) => s.toUpperCase()),
  expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const CACHE_MS = 1_000;

export function analyticsRoute(deps: TradfiDeps) {
  return async (app: FastifyInstance) => {
    const activityCache = new Map<string, { at: number; body: unknown }>();
    const parityCache = new Map<string, { at: number; body: unknown }>();

    for (const parity of [false, true]) {
      app.get(parity ? '/analytics/parity' : '/analytics', async (req, reply) => {
        const parsed = Query.safeParse(req.query);
        if (!parsed.success || (parity && !parsed.data.expiry)) {
          return reply
            .status(400)
            .send({ error: parity ? 'underlying and expiry required' : 'invalid analytics query' });
        }
        if (!deps.feed.readiness().catalogLoaded)
          return reply.status(503).send({ error: 'catalog not loaded' });
        const { underlying, expiry } = parsed.data;
        if (!deps.store.listUnderlyings().includes(underlying))
          return reply.status(404).send({ error: 'unknown underlying' });
        const now = Date.now();
        const available = liveExpiries(deps, underlying, now);
        if (expiry && !available.includes(expiry))
          return reply.status(404).send({ error: 'unknown or expired expiry' });
        const expiries = expiry ? [expiry] : available;
        for (const e of expiries)
          deps.feed.ensureChainSubscribed(underlying, e, parity ? 'parity' : 'analytics');
        const cache = parity ? parityCache : activityCache;
        const key = `${underlying}:${expiries.join(',')}`;
        const cached = cache.get(key);
        if (cached && now - cached.at < CACHE_MS) return cached.body;
        const body = parity
          ? TradfiParityResponseSchema.parse(buildParity(deps, underlying, expiry!, now))
          : TradfiAnalyticsResponseSchema.parse({
              ...buildAnalytics(deps, underlying, expiries, now),
              expiries: available,
            });
        for (const [k, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(k);
        cache.set(key, { at: now, body });
        return body;
      });
    }
  };
}
