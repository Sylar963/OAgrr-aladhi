import type { TradfiVolHistoryResponse } from '@oggregator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { TradfiStore } from '../runtime/store.js';
import type { CandleClient } from '../tastytrade/candle-client.js';
import type { RawCandle } from '../tastytrade/candle-codec.js';
import type { TradfiReadiness } from '../tastytrade/feed.js';

const DAY = 86_400_000;

const feed = {
  readiness: (): TradfiReadiness => ({
    catalogLoaded: true, quoteTokenAcquired: true, streaming: true,
    lastDataTs: 1, underlyings: 1, instruments: 1,
  }),
  ensureChainSubscribed: () => {},
  refreshChainQuotes: async () => 0,
};

function store() {
  const s = new TradfiStore();
  s.setInstruments(['SPX', 'AAPL'].map((u) => ({
    underlying: u, expiry: '2099-01-16', expiryTs: Date.UTC(2099, 0, 16, 21), strike: 100,
    right: 'call' as const, multiplier: 100, occSymbol: `${u}C`, streamerSymbol: `.${u}C`,
    canonical: `${u}C`, rootSymbol: u, settlementType: 'cash', expirationType: 'Regular', tickSizes: [],
  })));
  return s;
}

function candles(bySymbol: Record<string, number[]>, ready = true) {
  const getCandles = vi.fn(async (symbol: string): Promise<RawCandle[]> =>
    (bySymbol[symbol] ?? []).map((c, i) => ({
      symbol: `${symbol}{=d}`, flags: 0, time: Date.UTC(2026, 0, 1) + i * DAY,
      o: c, h: c, l: c, c, v: 1, iv: 0.25,
    })),
  );
  return { getCandles, client: { isReady: () => ready, getCandles } as unknown as CandleClient };
}

describe('GET /vol-history', () => {
  it('serves VIX as the SPX IV and caches the result', async () => {
    const { getCandles, client } = candles({ SPX: [5000, 5050], VIX: [15, 16] });
    const app = buildApp({ store: store(), feed, candleClient: client });

    const res = await app.inject({ method: 'GET', url: '/vol-history?underlying=spx' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TradfiVolHistoryResponse;
    expect(body.ivSource).toBe('VIX');
    expect(body.series.map((p) => p.iv)).toEqual([0.15, 0.16]);
    expect(getCandles.mock.calls.map((c) => [c[0], c[1]])).toEqual([['SPX', 'd'], ['VIX', 'd']]);

    await app.inject({ method: 'GET', url: '/vol-history?underlying=SPX' });
    expect(getCandles).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('rejects missing, unknown, and not-yet-streaming requests without caching', async () => {
    const { getCandles, client } = candles({ AAPL: [] });
    const app = buildApp({ store: store(), feed, candleClient: client });
    expect((await app.inject({ method: 'GET', url: '/vol-history' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/vol-history?underlying=ZZZ' })).statusCode).toBe(404);
    expect(getCandles).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'GET', url: '/vol-history?underlying=AAPL' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/vol-history?underlying=AAPL' })).statusCode).toBe(404);
    expect(getCandles).toHaveBeenCalledTimes(2);
    await app.close();

    const cold = buildApp({ store: store(), feed, candleClient: candles({}, false).client });
    expect((await cold.inject({ method: 'GET', url: '/vol-history?underlying=AAPL' })).statusCode).toBe(503);
    await cold.close();
  });
});
