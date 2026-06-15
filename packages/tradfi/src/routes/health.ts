import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { isUsEquityMarketOpen, QUOTE_STALE_MS } from '../tastytrade/health.js';

/**
 * /health  — liveness: always 200 while the process is up.
 * /ready   — readiness: 200 only when the catalog is loaded, DXLink is live, and
 *            data is actually flowing (fresh within QUOTE_STALE_MS) — or the
 *            market is closed, when no ticks are expected. A stream that died
 *            hours ago is NOT ready, even though it once received data.
 */
export function healthRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get('/health', async () => {
      const now = Date.now();
      const readiness = deps.feed.readiness();
      const marketOpen = isUsEquityMarketOpen(now);
      const fresh = readiness.lastDataTs > 0 && now - readiness.lastDataTs < QUOTE_STALE_MS;
      return {
        status: 'ok',
        uptimeSec: Math.round(process.uptime()),
        marketOpen,
        fresh,
        ageMs: readiness.lastDataTs > 0 ? now - readiness.lastDataTs : null,
        readiness,
      };
    });

    app.get('/ready', async (_req, reply) => {
      const now = Date.now();
      const readiness = deps.feed.readiness();
      const marketOpen = isUsEquityMarketOpen(now);
      const fresh = readiness.lastDataTs > 0 && now - readiness.lastDataTs < QUOTE_STALE_MS;
      const ready = readiness.catalogLoaded && readiness.streaming && (fresh || !marketOpen);
      if (!ready) return reply.status(503).send({ ready: false, marketOpen, fresh, readiness });
      return { ready: true, marketOpen, fresh, readiness };
    });
  };
}
