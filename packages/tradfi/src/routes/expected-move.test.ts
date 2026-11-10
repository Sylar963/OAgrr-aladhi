import { ExpectedMoveResponseSchema, ExpectedStraddleResponseSchema } from '@oggregator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { TradfiStore } from '../runtime/store.js';
import type { CandleClient } from '../tastytrade/candle-client.js';

const feed = {
  readiness: () => ({
    catalogLoaded: true,
    quoteTokenAcquired: true,
    streaming: true,
    lastDataTs: 1,
    underlyings: 1,
    instruments: 1,
  }),
  ensureChainSubscribed: vi.fn(),
  refreshChainQuotes: vi.fn().mockResolvedValue(0),
};

describe('SPX expected-move endpoints', () => {
  it('rejects crypto and invalid sessions before accessing the candle feed', async () => {
    const getCandles = vi.fn().mockResolvedValue([]);
    const app = buildApp({
      store: new TradfiStore(),
      feed,
      candleClient: { isReady: () => true, getCandles } as unknown as CandleClient,
    });
    expect((await app.inject('/expected-move?underlying=BTC&anchor=utc0')).statusCode).toBe(400);
    expect((await app.inject('/expected-move?underlying=SPX&anchor=utc0')).statusCode).toBe(400);
    expect(
      (await app.inject('/expected-move/straddle?underlying=SPX&venue=deribit&expiry=2026-11-12'))
        .statusCode,
    ).toBe(400);
    expect(getCandles).not.toHaveBeenCalled();
    await app.close();
  });

  it('shares session history loads and returns explicit missing quote state', async () => {
    const getCandles = vi.fn().mockResolvedValue([]);
    const app = buildApp({
      store: new TradfiStore(),
      feed,
      candleClient: { isReady: () => true, getCandles } as unknown as CandleClient,
    });
    const daily = await app.inject('/expected-move?underlying=SPX&anchor=cash');
    expect(daily.statusCode).toBe(200);
    expect(ExpectedMoveResponseSchema.parse(daily.json()).periodsPerYear).toBe(252);
    const straddle = await app.inject(
      '/expected-move/straddle?underlying=SPX&venue=tastytrade&expiry=2026-11-12',
    );
    expect(ExpectedStraddleResponseSchema.parse(straddle.json()).status).toBe('unavailable');
    expect(getCandles).toHaveBeenCalledTimes(4);
    await app.close();
  });

  it('reports a missing candle service without inventing opening benchmarks', async () => {
    const app = buildApp({ store: new TradfiStore(), feed });
    expect((await app.inject('/expected-move?underlying=SPX&anchor=cash')).statusCode).toBe(503);
    await app.close();
  });
});
