import type { FastifyInstance } from 'fastify';
import type { SpotCandleResolutionSec } from '@oggregator/core';
import {
  isAggregatedSpotUnderlying,
  isSpotCandleUnderlying,
  type SpotCandleWsMessage,
} from '@oggregator/protocol';
import { z } from 'zod';
import { aggregatedSpotRuntime, isSpotCandlesReady, spotCandleService } from '../services.js';
import { protectWebSocket } from '../websocket-security.js';

const SUPPORTED_RESOLUTIONS: readonly SpotCandleResolutionSec[] = [
  60, 300, 900, 1800, 3600, 14400, 86400,
];
const MAX_BUCKETS = 3000;
const WS_OPEN = 1;

/** Crypto tickers answer with real spot aggregated across venues; `source=perp` asks for the perp. */
export async function spotCandlesRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { currency?: string; resolution?: string; buckets?: string; source?: string };
  }>('/spot-candles', async (req, reply) => {
    const currency = (req.query.currency ?? 'BTC').toUpperCase();
    if (!isSpotCandleUnderlying(currency)) {
      return reply.status(400).send({ error: `No spot price history for ${currency}` });
    }

    const resolution = Number(req.query.resolution ?? 3600) as SpotCandleResolutionSec;
    if (!SUPPORTED_RESOLUTIONS.includes(resolution)) {
      return reply.status(400).send({ error: `Resolution must be one of ${SUPPORTED_RESOLUTIONS.join(', ')}s` });
    }

    const buckets = Math.min(MAX_BUCKETS, Math.max(1, Number(req.query.buckets ?? 24)));

    if (req.query.source !== 'perp' && isAggregatedSpotUnderlying(currency)) {
      const { candles, sources } = await aggregatedSpotRuntime.getCandles(currency, resolution, buckets);
      if (candles.length === 0) {
        return reply.status(502).send({ error: 'No spot venue returned candles' });
      }
      return { currency, resolution, count: candles.length, candles, sources };
    }

    if (!isSpotCandlesReady()) {
      return reply.status(503).send({ error: 'Spot candle service not available' });
    }

    try {
      const candles = await spotCandleService.getCandles(currency, resolution, buckets);
      return { currency, resolution, count: candles.length, candles };
    } catch (err: unknown) {
      req.log.warn({ err: String(err), currency, resolution }, 'spot-candles fetch failed');
      return reply.status(502).send({ error: 'Upstream candle fetch failed' });
    }
  });
}

const StreamQuerySchema = z.object({
  currency: z.string().transform((value) => value.toUpperCase()),
  resolution: z.coerce
    .number()
    .refine((value): value is SpotCandleResolutionSec =>
      (SUPPORTED_RESOLUTIONS as readonly number[]).includes(value),
    ),
});

export async function wsSpotCandlesRoute(app: FastifyInstance) {
  app.get('/ws/spot-candles', { websocket: true }, (socket, req) => {
    if (!protectWebSocket(socket, req.ip)) return;

    const send = (message: SpotCandleWsMessage) => {
      if (socket.readyState === WS_OPEN) socket.send(JSON.stringify(message));
    };

    const query = StreamQuerySchema.safeParse(req.query);
    if (!query.success || !isAggregatedSpotUnderlying(query.data.currency)) {
      send({ type: 'error', message: 'Invalid spot candle stream query' });
      socket.close(1008, 'Invalid query');
      return;
    }

    const stop = aggregatedSpotRuntime.subscribe(
      query.data.currency,
      query.data.resolution,
      (candle) => send({ type: 'bar', candle }),
    );
    socket.once('close', stop);
  });
}
