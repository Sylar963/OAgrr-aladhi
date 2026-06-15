import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildCandlesResponse } from '../runtime/candles.js';
import { InstrumentCandleIntervalSchema, InstrumentCandleRangeSchema } from '@oggregator/protocol';

export function candlesRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: Record<string, string> }>('/candles', async (req, reply) => {
      const { underlying, expiry, strike, right, interval, range } = req.query;
      const i = InstrumentCandleIntervalSchema.safeParse(interval);
      const r = InstrumentCandleRangeSchema.safeParse(range);
      if (!underlying || !expiry || !strike || (right !== 'call' && right !== 'put') || !i.success || !r.success) {
        return reply.status(400).send({ error: 'underlying, expiry, strike, right(call|put), interval, range required' });
      }
      if (!deps.candleClient || !deps.candleClient.isReady()) {
        return reply.status(503).send({ error: 'candle feed not ready' });
      }
      const res = await buildCandlesResponse(deps.candleClient, deps.store, {
        underlying, expiry, strike: Number(strike), right, interval: i.data, range: r.data, nowMs: Date.now(),
      });
      if (res === null) return reply.status(404).send({ error: 'instrument not found' });
      return res;
    });
  };
}
