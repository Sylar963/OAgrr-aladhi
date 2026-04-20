import type { FastifyInstance } from 'fastify';
import { paperTradingStore } from '../../trading-services.js';
import { listTradeFills } from './workspace.js';

export async function paperFillsRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { limit?: string; tradeId?: string };
  }>('/paper/fills', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply
        .status(503)
        .send({ error: 'persistence_unavailable', message: 'DATABASE_URL not set' });
    }
    const limit = Math.min(Number(req.query.limit ?? '100') || 100, 500);
    return { fills: await listTradeFills(limit, req.query.tradeId) };
  });
}
