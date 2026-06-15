import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { isUsEquityMarketOpen } from '../tastytrade/health.js';

/**
 * /health  — liveness: always 200 while the process is up.
 * /ready   — readiness: 200 only once the catalog is loaded and data is flowing
 *            (streaming or at least one event/REST snapshot landed), else 503.
 */
export function healthRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get('/health', async () => {
      const readiness = deps.feed.readiness();
      return {
        status: 'ok',
        uptimeSec: Math.round(process.uptime()),
        marketOpen: isUsEquityMarketOpen(Date.now()),
        readiness,
      };
    });

    app.get('/ready', async (_req, reply) => {
      const readiness = deps.feed.readiness();
      const ready = readiness.catalogLoaded && (readiness.streaming || readiness.lastDataTs > 0);
      if (!ready) return reply.status(503).send({ ready: false, readiness });
      return { ready: true, readiness };
    });
  };
}
