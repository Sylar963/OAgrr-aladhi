import type { SpotCandleResolutionSec } from '@oggregator/core';
import { isAggregatedSpotUnderlying } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aggregatedSpotRuntime } from '../services.js';

const MAX_BUCKETS = 3000;

export const SpotResolutionSchema = z.coerce
  .number()
  .refine((value): value is SpotCandleResolutionSec =>
    [60, 300, 900, 1800, 3600, 14400, 86400].includes(value),
  );

const QuerySchema = z.object({
  currency: z.string().transform((value) => value.toUpperCase()),
  resolution: SpotResolutionSchema,
  buckets: z.coerce.number().int().min(1).max(MAX_BUCKETS),
});

export async function aggregatedSpotCandlesRoute(app: FastifyInstance) {
  app.get('/spot-aggregate-candles', async (req, reply) => {
    const query = QuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'currency, resolution and buckets are required' });
    }
    const { currency, resolution, buckets } = query.data;
    if (!isAggregatedSpotUnderlying(currency)) {
      return reply.status(400).send({ error: `No aggregated spot history for ${currency}` });
    }

    const { candles, sources } = await aggregatedSpotRuntime.getCandles(currency, resolution, buckets);
    if (candles.length === 0) {
      return reply.status(502).send({ error: 'No spot venue returned candles' });
    }
    return { currency, resolution, count: candles.length, candles, sources };
  });
}
