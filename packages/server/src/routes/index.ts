import type { FastifyInstance } from 'fastify';
import { isReady } from '../app.js';
import { healthRoute } from './health.js';
import { venuesRoute } from './venues.js';
import { underlyingsRoute } from './underlyings.js';
import { expiriesRoute } from './expiries.js';
import { chainsRoute } from './chains.js';
import { surfaceRoute } from './surface.js';

export function registerRoutes(app: FastifyInstance) {
  // Return 503 while adapters are still bootstrapping
  app.addHook('onRequest', async (_req, reply) => {
    if (!isReady() && _req.url !== '/api/health') {
      return reply.status(503).send({ error: 'initializing', message: 'Server is loading market data' });
    }
  });

  app.register(healthRoute, { prefix: '/api' });
  app.register(venuesRoute, { prefix: '/api' });
  app.register(underlyingsRoute, { prefix: '/api' });
  app.register(expiriesRoute, { prefix: '/api' });
  app.register(chainsRoute, { prefix: '/api' });
  app.register(surfaceRoute, { prefix: '/api' });
}
