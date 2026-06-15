import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildChain } from '../runtime/chain.js';
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

        // Start streaming this chain (idempotent) so subsequent polls/WS pushes fill in.
        deps.feed.ensureChainSubscribed(underlying, expiry);

        // Cold start: the WS store has produced nothing yet. Try a best-effort REST
        // snapshot for just this chain (no-op when the account lacks the entitlement).
        if (r.lastDataTs === 0 && !deps.store.hasQuotesFor(underlying, expiry)) {
          try {
            await deps.feed.refreshChainQuotes(underlying, expiry);
          } catch (err: unknown) {
            log.warn({ underlying, expiry, err: String(err) }, 'rest fallback refresh failed');
          }
        }

        // Up, with instruments, but no data from either path → honest "warming up".
        if (r.lastDataTs === 0 && !deps.store.hasQuotesFor(underlying, expiry)) {
          return reply.status(503).send({ error: 'no market data yet', readiness: deps.feed.readiness() });
        }

        const source = deps.store.hasQuotesFor(underlying, expiry) && r.lastDataTs === 0 ? 'rest' : 'ws';
        return buildChain(deps.store, underlying, expiry, source);
      },
    );
  };
}
