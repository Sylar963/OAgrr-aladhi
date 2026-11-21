import { PublicDepthError, type PublicDepthRuntime } from '@oggregator/core';
import { BotDepthQuerySchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { chainEngines } from '../chain-engines.js';

export interface BotDepthOptions {
  runtime: Pick<PublicDepthRuntime, 'snapshot'>;
}
export async function botDepthRoute(app: FastifyInstance, options: BotDepthOptions) {
  app.get(
    '/bot/depth',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = BotDepthQuerySchema.safeParse(req.query);
      if (!parsed.success)
        return reply.code(400).send({ error: 'invalid_depth_query', issues: parsed.error.issues });
      const query = parsed.data;
      reply.header('Cache-Control', 'no-store');
      const acquired = await chainEngines.acquire({
        underlying: query.underlying,
        expiry: query.expiry,
        venues: [query.venue],
      });
      try {
        const chain = await acquired.runtime.fetchSnapshotData();
        const quotes = chain.strikes.flatMap((row) => [
          row.call.venues[query.venue],
          row.put.venues[query.venue],
        ]);
        const quote = quotes.find((quote) => quote?.execution?.exchangeSymbol === query.instrument);
        if (!quote?.execution)
          return reply
            .code(404)
            .send({ error: 'instrument_not_in_market', instrument: query.instrument });
        try {
          const depth = await options.runtime.snapshot(query, {
            execution: quote.execution,
            underlyingPriceUsd: quote.underlyingPriceUsd ?? null,
            asOfMs: quote.asOfMs ?? null,
          });
          const venueHealth =
            acquired.runtime.getHealthDetails().find((health) => health.venue === query.venue) ??
            null;
          const live = venueHealth?.state === 'connected' || venueHealth?.state === 'polling';
          return {
            ...depth,
            venueHealth,
            dataReady: depth.dataReady && live,
            reasons: live ? depth.reasons : [...depth.reasons, 'venue-not-live'],
          };
        } catch (error) {
          if (!(error instanceof PublicDepthError)) throw error;
          const code =
            error.reason === 'capacity' ? 429 : error.reason === 'unsupported-access' ? 400 : 503;
          return reply.code(code).send({
            error: 'public_depth_unavailable',
            reason: error.reason,
            venue: query.venue,
            instrument: query.instrument,
          });
        }
      } finally {
        await acquired.release();
      }
    },
  );
}
