import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildUnderlyingCandlesResponse } from '../runtime/candles.js';
import { InstrumentCandleIntervalSchema, InstrumentCandleRangeSchema } from '@oggregator/protocol';

export function underlyingCandlesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: Record<string, string> }>('/underlying-candles', async (req, reply) => {
      const { underlying, interval, range } = req.query;
      const i = InstrumentCandleIntervalSchema.safeParse(interval);
      const r = InstrumentCandleRangeSchema.safeParse(range);
      if (!underlying || !i.success || !r.success) {
        return reply.status(400).send({ error: 'underlying, interval, range required' });
      }
      if (!deps.candleClient || !deps.candleClient.isReady()) {
        return reply.status(503).send({ error: 'candle feed not ready' });
      }
      return buildUnderlyingCandlesResponse(deps.candleClient, {
        underlying, interval: i.data, range: r.data, nowMs: Date.now(),
      });
    });
  };
}
