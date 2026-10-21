import {
  OrderBookCapacityError,
  type OrderBookSnapshot,
  OrderBookUnavailableError,
} from '@oggregator/core';
import { LiquidityResponseSchema } from '@oggregator/protocol';
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
