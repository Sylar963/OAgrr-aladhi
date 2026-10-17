import {
  costToFill,
  depthWithin,
  isThalexBookInstrument,
  OrderBookCapacityError,
  type OrderBookRuntime,
  type OrderBookSnapshot,
  OrderBookUnavailableError,
} from '@oggregator/core';
import {
  LIQUIDITY_DEPTH_BANDS_PCT,
  LIQUIDITY_LADDER_LEVELS,
  type LiquidityQuery,
  LiquidityQuerySchema,
  type LiquidityResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

const BOOK_WAIT_MS = 3_000;

export interface LiquidityRouteOptions {
  runtime: Pick<OrderBookRuntime, 'acquire' | 'waitForBook'> | null;
  now?: () => number;
}

export function buildLiquidityResponse(
  book: OrderBookSnapshot,
  query: LiquidityQuery,
  now: number,
): LiquidityResponse {
  const bestBid = book.bids[0]?.price ?? null;
  const bestAsk = book.asks[0]?.price ?? null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  return {
    venue: book.venue,
    instrument: book.instrument,
    priceUnit: book.priceUnit,
    quantityUnit: book.quantityUnit,
    state: book.state,
    crossed: book.crossed,
    asOf: now,
    bookAgeMs: Math.max(0, now - book.receivedAt),
    exchangeTs: book.exchangeTs,
    mark: book.mark
      ? {
          markPrice: book.mark.markPrice,
          indexPrice: book.mark.indexPrice,
          delta: book.mark.delta,
          iv: book.mark.iv,
          ageMs: Math.max(0, now - book.mark.receivedAt),
        }
      : null,
    bestBid,
    bestAsk,
    spread,
    spreadPct: spread !== null && mid ? (spread / mid) * 100 : null,
    fill: costToFill(book, query.side, query.size),
    depth: depthWithin(book, LIQUIDITY_DEPTH_BANDS_PCT),
    bids: book.bids.slice(0, LIQUIDITY_LADDER_LEVELS),
    asks: book.asks.slice(0, LIQUIDITY_LADDER_LEVELS),
  };
}

export async function liquidityRoute(app: FastifyInstance, options: LiquidityRouteOptions) {
  const now = options.now ?? Date.now;

  app.get(
    '/liquidity',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const runtime = options.runtime;
      if (runtime == null) {
        return reply.status(503).send({ error: 'order books disabled' });
      }
      const parsed = LiquidityQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'invalid liquidity query', details: parsed.error.flatten() });
      }
      if (!isThalexBookInstrument(parsed.data.instrument)) {
        return reply.status(400).send({ error: 'unsupported instrument' });
      }

      let lease: ReturnType<typeof runtime.acquire>;
      try {
        lease = runtime.acquire(parsed.data.instrument);
      } catch (error) {
        if (error instanceof OrderBookCapacityError) {
          return reply.status(429).send({ error: 'order book capacity reached' });
        }
        throw error;
      }
      try {
        const book = await runtime.waitForBook(parsed.data.instrument, BOOK_WAIT_MS);
        return buildLiquidityResponse(book, parsed.data, now());
      } catch (error) {
        if (error instanceof OrderBookUnavailableError) {
          const status = error.reason === 'rejected' ? 404 : 503;
          return reply.status(status).send({ error: `order book ${error.reason}` });
        }
        throw error;
      } finally {
        lease.release();
      }
    },
  );
}
