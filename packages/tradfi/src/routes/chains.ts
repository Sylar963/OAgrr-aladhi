import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildChain } from '../runtime/chain.js';

export function chainsRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string; expiry?: string } }>(
      '/chains',
      async (req, reply) => {
        const { underlying, expiry } = req.query;
        if (!underlying || !expiry) {
          return reply.status(400).send({ error: 'underlying and expiry required' });
        }
        if (!deps.feed.isLoaded()) {
          return reply.status(503).send({ error: 'not ready' });
        }
        return buildChain(deps.store, underlying, expiry, 'ws');
      },
    );
  };
}
