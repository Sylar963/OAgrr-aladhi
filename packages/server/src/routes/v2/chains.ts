import type { FastifyInstance } from 'fastify';
import { getAdaptersByAssetClass } from '../../asset-class.js';

/**
 * v2 chain endpoint — listed-options (equities, ETFs, indexes) via Tastytrade.
 *
 * Wire-up pending: returns 503 until a tradfi adapter is registered.
 * Full enrichment + WS push will land alongside the live adapter.
 */
export async function v2ChainsRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying: string; expiry: string; venues?: string };
  }>('/v2/chains', async (req, reply) => {
    const { underlying, expiry } = req.query;

    if (!underlying || !expiry) {
      return reply.status(400).send({ error: 'underlying and expiry query params required' });
    }

    const adapters = getAdaptersByAssetClass('tradfi');
    if (adapters.length === 0) {
      return reply
        .status(503)
        .send({ error: 'no tradfi venues registered', message: 'v2 chain not yet available' });
    }

    return {
      underlying,
      expiry,
      asOf: Date.now(),
      rows: [],
      stats: null,
    };
  });
}
