import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';

export function expiriesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string } }>('/expiries', async (req, reply) => {
      const underlying = req.query.underlying;
      if (!underlying) return reply.status(400).send({ error: 'underlying required' });
      const expiries = deps.store.listExpiries(underlying);
      const timestamps = expiries.map((expiry) => ({
        expiry,
        expiryTs: deps.store
          .instrumentsFor(underlying, expiry)
          .reduce<number | null>(
            (earliest, instrument) =>
              Number.isFinite(instrument.expiryTs) && instrument.expiryTs > 0
                ? Math.min(earliest ?? instrument.expiryTs, instrument.expiryTs)
                : earliest,
            null,
          ),
      }));
      return { underlying, expiries, timestamps };
    });
  };
}
