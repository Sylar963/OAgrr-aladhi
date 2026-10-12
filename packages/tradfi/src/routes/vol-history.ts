import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import type { VolHistorySource } from '../runtime/vol-history.js';

export function volHistoryRoute(deps: TradfiDeps, source: VolHistorySource | undefined) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string } }>('/vol-history', async (req, reply) => {
      const underlying = req.query.underlying?.toUpperCase();
      if (!underlying) {
        return reply.status(400).send({ error: 'underlying query param required' });
      }
      if (source == null || !source.isReady()) {
        return reply.status(503).send({ error: 'candle feed not ready' });
      }
      if (deps.store.listExpiries(underlying).length === 0) {
        return reply.status(404).send({ error: `unknown underlying ${underlying}` });
      }
      const body = await source.get(underlying);
      if (body == null) {
        return reply.status(404).send({ error: `no daily history for ${underlying}` });
      }
      return body;
    });
  };
}
