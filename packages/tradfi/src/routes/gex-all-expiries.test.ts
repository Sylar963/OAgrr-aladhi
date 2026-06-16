import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { buildChain } from '../runtime/chain.js';
import { TradfiStore } from '../runtime/store.js';
import type { TradfiReadiness } from '../tastytrade/feed.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

function readyFeed() {
  const readiness: TradfiReadiness = {
    catalogLoaded: true, quoteTokenAcquired: true, streaming: true,
    lastDataTs: Date.now(), underlyings: 1, instruments: 2,
  };
  return {
    readiness: () => readiness,
    ensureChainSubscribed: () => {},
    refreshChainQuotes: async () => 0,
  };
}

function seed(store: TradfiStore) {
  const base: Omit<TradfiInstrument, 'streamerSymbol' | 'canonical' | 'expiry' | 'occSymbol'> = {
    underlying: 'SPX', strike: 5000, right: 'call', multiplier: 100,
    rootSymbol: 'SPX', settlementType: 'cash', expirationType: 'Regular',
  };
  store.setInstruments([
    { ...base, expiry: '2026-06-18', occSymbol: 'SPXA', streamerSymbol: '.A', canonical: 'SPX-20260618-5000-C' },
    { ...base, expiry: '2026-06-19', occSymbol: 'SPXB', streamerSymbol: '.B', canonical: 'SPX-20260619-5000-C' },
  ]);
  store.setSpot('SPX', 5000);
  store.mergeQuote('.A', { ts: 1, gamma: 0.001, openInterest: 1000, bid: 1, ask: 2, mark: 1.5 });
  store.mergeQuote('.B', { ts: 1, gamma: 0.001, openInterest: 500, bid: 1, ask: 2, mark: 1.5 });
}

describe('GET /gex-all-expiries', () => {
  it('aggregates signed GEX across all expiries for the underlying', async () => {
    const store = new TradfiStore();
    seed(store);
    const app = buildApp({ store, feed: readyFeed() });
    const res = await app.inject({ method: 'GET', url: '/gex-all-expiries?underlying=SPX' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { underlying: string; expiries: string[]; spotPrice: number | null; gex: Array<{ strike: number; gexUsdMillions: number }> };
    expect(body.underlying).toBe('SPX');
    expect(body.expiries).toEqual(['2026-06-18', '2026-06-19']);
    expect(body.spotPrice).toBe(5000);
    const at5000 = body.gex.find((g) => g.strike === 5000)!;
    expect(at5000.gexUsdMillions).toBeGreaterThan(0);
    // Prove the two expiries were actually summed (not just the first returned).
    const gexA = buildChain(store, 'SPX', '2026-06-18', 'ws').gex.find((g) => g.strike === 5000)!;
    const gexB = buildChain(store, 'SPX', '2026-06-19', 'ws').gex.find((g) => g.strike === 5000)!;
    expect(at5000.gexUsdMillions).toBeCloseTo(gexA.gexUsdMillions + gexB.gexUsdMillions, 6);
    await app.close();
  });

  it('400s without an underlying', async () => {
    const app = buildApp({ store: new TradfiStore(), feed: readyFeed() });
    const res = await app.inject({ method: 'GET', url: '/gex-all-expiries' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
