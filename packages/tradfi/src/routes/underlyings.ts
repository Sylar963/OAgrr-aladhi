import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';

export function underlyingsRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get('/underlyings', async () => ({ underlyings: deps.store.listUnderlyings() }));
  };
}
