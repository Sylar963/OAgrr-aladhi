import { isAggregatedSpotUnderlying, type SpotCandleWsMessage } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aggregatedSpotRuntime } from '../services.js';
import { protectWebSocket } from '../websocket-security.js';
import { SpotResolutionSchema } from './spot-aggregate-candles.js';

const WS_OPEN = 1;

const QuerySchema = z.object({
  currency: z.string().transform((value) => value.toUpperCase()),
  resolution: SpotResolutionSchema,
});

export async function wsSpotCandlesRoute(app: FastifyInstance) {
  app.get('/ws/spot-candles', { websocket: true }, (socket, req) => {
    if (!protectWebSocket(socket, req.ip)) return;

    const send = (message: SpotCandleWsMessage) => {
      if (socket.readyState === WS_OPEN) socket.send(JSON.stringify(message));
    };

    const query = QuerySchema.safeParse(req.query);
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
