import {
  OrderBookCapacityError,
  type OrderBookSnapshot,
  OrderBookUnavailableError,
} from '@oggregator/core';
import { LiquidityCloseResponseSchema, LiquidityResponseSchema } from '@oggregator/protocol';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { liquidityRoute } from './liquidity.js';

const NOW = 10_000;

function book(): OrderBookSnapshot {
  return {
    venue: 'thalex',
    instrument: 'BTC-PERPETUAL',
    priceUnit: 'usd',
    quantityUnit: 'base',
    bids: [
      { price: 100, amount: 1, outrightAmount: 1 },
      { price: 99, amount: 2, outrightAmount: 2 },
    ],
    asks: [
      { price: 101, amount: 1, outrightAmount: 1 },
      { price: 102, amount: 2, outrightAmount: 2 },
    ],
    totalBidAmount: 3,
    totalAskAmount: 3,
    exchangeTs: 9_000,
    receivedAt: 9_500,
    generation: 1,
    state: 'synced',
    crossed: false,
    mark: {
      markPrice: 100.5,
      indexPrice: 100.4,
      delta: 1,
      iv: null,
      collarLow: null,
      collarHigh: null,
      receivedAt: 9_000,
    },
  };
}

async function buildApp(runtime: Parameters<typeof liquidityRoute>[1]['runtime']) {
  const app = Fastify({ logger: false });
  await app.register(liquidityRoute, { prefix: '/api', runtime, now: () => NOW });
  await app.ready();
  return app;
}

function runtime(waitForBook: () => Promise<OrderBookSnapshot>) {
  const release = vi.fn();
  return {
    release,
    acquire: vi.fn(() => ({ release })),
    waitForBook: vi.fn(waitForBook),
  };
}

describe('GET /api/liquidity', () => {
  it('returns a fill estimate, depth bands and the ladder, and releases the lease', async () => {
    const r = runtime(async () => book());
    const app = await buildApp(r);

    const res = await app.inject({
      method: 'GET',
      url: '/api/liquidity?instrument=BTC-PERPETUAL&side=buy&size=2',
    });

    expect(res.statusCode).toBe(200);
    const body = LiquidityResponseSchema.parse(res.json());
    expect(body.fill).toMatchObject({ filled: 2, fullyFilled: true, vwap: 101.5, levelsUsed: 2 });
    expect(body).toMatchObject({
      bestBid: 100,
      bestAsk: 101,
      spread: 1,
      bookAgeMs: 500,
      mark: { markPrice: 100.5, ageMs: 1_000 },
    });
    expect(body.depth.map((d) => d.pct)).toEqual([0.5, 1, 2, 5]);
    expect(r.release).toHaveBeenCalledOnce();
  });

  it('accepts combo instruments', async () => {
    const r = runtime(async () => ({ ...book(), instrument: '[BTC-23OCT26-84000-C:-1,BTC-23OCT26-84000-P:1]' }));
    const app = await buildApp(r);
    const res = await app.inject({
      method: 'GET',
      url: `/api/liquidity?instrument=${encodeURIComponent('[BTC-23OCT26-84000-C:-1,BTC-23OCT26-84000-P:1]')}&side=sell&size=1`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('validates the query and the instrument before subscribing', async () => {
    const r = runtime(async () => book());
    const app = await buildApp(r);
    expect((await app.inject({ url: '/api/liquidity?instrument=BTC-PERPETUAL&side=buy&size=0' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/liquidity?instrument=BTC-PERPETUAL&side=hold&size=1' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/liquidity?instrument=SOL-PERPETUAL&side=buy&size=1' })).statusCode).toBe(400);
    expect(r.acquire).not.toHaveBeenCalled();
  });

  it('maps runtime errors', async () => {
    const rejected = await buildApp(
      runtime(async () => {
        throw new OrderBookUnavailableError('BTC-01JAN20-1000-C', 'rejected');
      }),
    );
    expect((await rejected.inject({ url: '/api/liquidity?instrument=BTC-01JAN20-1000-C&side=buy&size=1' })).statusCode).toBe(404);

    const timeout = await buildApp(
      runtime(async () => {
        throw new OrderBookUnavailableError('BTC-PERPETUAL', 'timeout');
      }),
    );
    expect((await timeout.inject({ url: '/api/liquidity?instrument=BTC-PERPETUAL&side=buy&size=1' })).statusCode).toBe(503);

    const full = runtime(async () => book());
    full.acquire.mockImplementation(() => {
      throw new OrderBookCapacityError(40);
    });
    const capped = await buildApp(full);
    expect((await capped.inject({ url: '/api/liquidity?instrument=BTC-PERPETUAL&side=buy&size=1' })).statusCode).toBe(429);
  });

  it('503s when order books are disabled', async () => {
    const app = await buildApp(null);
    expect((await app.inject({ url: '/api/liquidity?instrument=BTC-PERPETUAL&side=buy&size=1' })).statusCode).toBe(503);
  });
});

describe('GET /api/liquidity/close', () => {
  const legs = (...params: string[]) =>
    `/api/liquidity/close?${params.map((p) => `leg=${encodeURIComponent(p)}`).join('&')}`;

  it('estimates every leg in one request and releases every lease', async () => {
    const r = runtime(async () => book());
    const app = await buildApp(r);

    const res = await app.inject({ url: legs('sell:2:BTC-PERPETUAL', 'buy:0.5:ETH-PERPETUAL') });

    expect(res.statusCode).toBe(200);
    const body = LiquidityCloseResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      instrument: 'BTC-PERPETUAL',
      side: 'sell',
      size: 2,
      error: null,
      quote: { bestBid: 100, fill: { filled: 2, vwap: 99.5 } },
    });
    expect(body.items[1]?.quote?.fill).toMatchObject({ filled: 0.5, vwap: 101 });
    expect(body.items[0]?.quote).not.toHaveProperty('bids');
    expect(r.acquire).toHaveBeenCalledTimes(2);
    expect(r.release).toHaveBeenCalledTimes(2);
  });

  it('passes the venue price collars through', async () => {
    const collared = book();
    collared.mark = { ...collared.mark!, collarLow: 90, collarHigh: 110 };
    const app = await buildApp(runtime(async () => collared));
    const res = await app.inject({ url: legs('buy:1:BTC-PERPETUAL') });
    expect(LiquidityCloseResponseSchema.parse(res.json()).items[0]?.quote?.mark).toMatchObject({
      collarLow: 90,
      collarHigh: 110,
    });
  });

  it('accepts a single leg param', async () => {
    const app = await buildApp(runtime(async () => book()));
    const res = await app.inject({ url: legs('buy:1:BTC-23OCT26-84000-C') });
    expect(res.statusCode).toBe(200);
    expect(LiquidityCloseResponseSchema.parse(res.json()).items).toHaveLength(1);
  });

  it('reports per-leg failures without failing the batch', async () => {
    const r = runtime(async () => {
      throw new OrderBookUnavailableError('BTC-01JAN20-1000-C', 'timeout');
    });
    const app = await buildApp(r);

    const res = await app.inject({ url: legs('sell:1:SOL-PERPETUAL', 'buy:1:BTC-01JAN20-1000-C') });

    expect(res.statusCode).toBe(200);
    const body = LiquidityCloseResponseSchema.parse(res.json());
    expect(body.items.map((i) => i.error)).toEqual(['unsupported', 'timeout']);
    expect(r.acquire).toHaveBeenCalledOnce();
    expect(r.release).toHaveBeenCalledOnce();
  });

  it('reports capacity per leg', async () => {
    const r = runtime(async () => book());
    r.acquire.mockImplementation(() => {
      throw new OrderBookCapacityError(40);
    });
    const app = await buildApp(r);
    const res = await app.inject({ url: legs('sell:1:BTC-PERPETUAL') });
    expect(LiquidityCloseResponseSchema.parse(res.json()).items[0]?.error).toBe('capacity');
  });

  it('validates the legs', async () => {
    const r = runtime(async () => book());
    const app = await buildApp(r);
    expect((await app.inject({ url: '/api/liquidity/close' })).statusCode).toBe(400);
    expect((await app.inject({ url: legs('hold:1:BTC-PERPETUAL') })).statusCode).toBe(400);
    expect((await app.inject({ url: legs('sell:0:BTC-PERPETUAL') })).statusCode).toBe(400);
    expect(r.acquire).not.toHaveBeenCalled();
  });

  it('503s when order books are disabled', async () => {
    const app = await buildApp(null);
    expect((await app.inject({ url: legs('sell:1:BTC-PERPETUAL') })).statusCode).toBe(503);
  });
});
