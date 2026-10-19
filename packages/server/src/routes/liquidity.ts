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
  type LiquidityCloseError,
  type LiquidityCloseItem,
  LiquidityCloseQuerySchema,
  type LiquidityCloseResponse,
  type LiquidityQuery,
  LiquidityQuerySchema,
  type LiquidityQuote,
  type LiquidityResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

const BOOK_WAIT_MS = 3_000;

export interface LiquidityRouteOptions {
  runtime: Pick<OrderBookRuntime, 'acquire' | 'waitForBook'> | null;
  now?: () => number;
}

export function buildLiquidityQuote(
  book: OrderBookSnapshot,
  query: LiquidityQuery,
  now: number,
): LiquidityQuote {
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
          collarLow: book.mark.collarLow,
          collarHigh: book.mark.collarHigh,
          ageMs: Math.max(0, now - book.mark.receivedAt),
        }
      : null,
    bestBid,
    bestAsk,
    spread,
    spreadPct: spread !== null && mid ? (spread / mid) * 100 : null,
    fill: costToFill(book, query.side, query.size),
  };
}

export function buildLiquidityResponse(
  book: OrderBookSnapshot,
  query: LiquidityQuery,
  now: number,
): LiquidityResponse {
  return {
    ...buildLiquidityQuote(book, query, now),
    depth: depthWithin(book, LIQUIDITY_DEPTH_BANDS_PCT),
    bids: book.bids.slice(0, LIQUIDITY_LADDER_LEVELS),
    asks: book.asks.slice(0, LIQUIDITY_LADDER_LEVELS),
  };
}

function closeError(error: unknown): LiquidityCloseError {
  if (error instanceof OrderBookCapacityError) return 'capacity';
  if (error instanceof OrderBookUnavailableError) return error.reason;
  throw error;
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

  // Every leg of a book in one request, so a panel can poll all its legs without tripping
  // the per-instrument route's rate limit. Leases are taken together so the books warm in parallel.
  app.get(
    '/liquidity/close',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const runtime = options.runtime;
      if (runtime == null) {
        return reply.status(503).send({ error: 'order books disabled' });
      }
      const parsed = LiquidityCloseQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'invalid liquidity query', details: parsed.error.flatten() });
      }

      const leases: Array<ReturnType<typeof runtime.acquire>> = [];
      try {
        const pending = parsed.data.leg.map(async (query): Promise<LiquidityCloseItem> => {
          const base = { instrument: query.instrument, side: query.side, size: query.size };
          if (!isThalexBookInstrument(query.instrument)) {
            return { ...base, quote: null, error: 'unsupported' };
          }
          try {
            leases.push(runtime.acquire(query.instrument));
            const book = await runtime.waitForBook(query.instrument, BOOK_WAIT_MS);
            return { ...base, quote: buildLiquidityQuote(book, query, now()), error: null };
          } catch (error) {
            return { ...base, quote: null, error: closeError(error) };
          }
        });
        const body: LiquidityCloseResponse = { asOf: now(), items: await Promise.all(pending) };
        return body;
      } finally {
        for (const lease of leases) lease.release();
      }
    },
  );
}
