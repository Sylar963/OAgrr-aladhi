import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildChain } from '../runtime/chain.js';
import { isUsEquityMarketOpen, QUOTE_STALE_MS } from '../tastytrade/health.js';
import { feedLogger } from '../logger.js';

const log = feedLogger('tradfi-chains');

export function chainsRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string; expiry?: string } }>(
      '/chains',
      async (req, reply) => {
        const { underlying, expiry } = req.query;
        if (!underlying || !expiry) {
          return reply.status(400).send({ error: 'underlying and expiry required' });
        }

        const r = deps.feed.readiness();
        if (!r.catalogLoaded) {
          return reply.status(503).send({ error: 'catalog not loaded', readiness: r });
        }

        // No instruments for this expiry is a genuinely empty chain, not a fault.
        const insts = deps.store.instrumentsFor(underlying, expiry);
        if (insts.length === 0) {
          return buildChain(deps.store, underlying, expiry, 'ws');
        }

        // Keep this chain streaming (idempotent) so WS holds it fresh.
        deps.feed.ensureChainSubscribed(underlying, expiry);

        // Best-effort REST backfill when this chain has no data yet OR has gone
        // stale while the market is open (the WS feed lagged/dropped for it).
        // refreshChainQuotes self-throttles, so repeated polls don't hammer REST.
        const now = Date.now();
        const newest = deps.store.newestQuoteTs(underlying, expiry);
        const stale = newest === 0 || (isUsEquityMarketOpen(now) && now - newest > QUOTE_STALE_MS);
        if (stale) {
          try {
            await deps.feed.refreshChainQuotes(underlying, expiry);
          } catch (err: unknown) {
            log.warn({ underlying, expiry, err: String(err) }, 'rest fallback refresh failed');
          }
        }

        // Up, with instruments, but no data from either path → honest "warming up".
        if (deps.store.newestQuoteTs(underlying, expiry) === 0) {
          return reply.status(503).send({ error: 'no market data yet', readiness: deps.feed.readiness() });
        }

        return buildChain(deps.store, underlying, expiry, 'ws');
      },
    );
  };
}
