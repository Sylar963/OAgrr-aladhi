import type { FastifyInstance } from 'fastify';
import { flowService, isFlowReady } from '../services.js';

export async function flowRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; minNotional?: string; limit?: string };
  }>('/flow', async (req, reply) => {
    if (!isFlowReady()) {
      return reply.status(503).send({ error: 'flow service not available' });
    }
    const underlying = req.query.underlying ?? 'BTC';
    const minNotional = Number(req.query.minNotional) || 0;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const trades = flowService.getTrades(underlying, minNotional);

    return {
      underlying,
      count: trades.length,
      trades: trades.slice(-limit).reverse(),
    };
  });
}
