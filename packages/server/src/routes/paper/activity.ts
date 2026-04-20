import type { FastifyInstance } from 'fastify';
import { paperTradingStore } from '../../trading-services.js';
import { listTradeActivities } from './workspace.js';

export async function paperActivityRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { limit?: string; tradeId?: string };
  }>('/paper/activity', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply
        .status(503)
        .send({ error: 'persistence_unavailable', message: 'DATABASE_URL not set' });
    }
    const limit = Math.min(Number(req.query.limit ?? '100') || 100, 500);
    return { activity: await listTradeActivities(limit, req.query.tradeId) };
  });
}
