import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';

export function expiriesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string } }>('/expiries', async (req, reply) => {
      const underlying = req.query.underlying;
      if (!underlying) return reply.status(400).send({ error: 'underlying required' });
      return { underlying, expiries: deps.store.listExpiries(underlying) };
    });
  };
}
