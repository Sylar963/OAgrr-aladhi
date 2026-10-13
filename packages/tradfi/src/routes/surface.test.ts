import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { TradfiStore } from '../runtime/store.js';
import type { CandleClient } from '../tastytrade/candle-client.js';
import type { TradfiReadiness } from '../tastytrade/feed.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';
import type { TradfiSurfaceResponse } from './surface.js';

const DAY = 86_400_000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function feed(catalogLoaded = true) {
  const readiness: TradfiReadiness = {
    catalogLoaded, quoteTokenAcquired: true, streaming: true,
    lastDataTs: Date.now(), underlyings: 1, instruments: 1,
  };
  const subscribed: string[] = [];
  const tiers: (string | undefined)[] = [];
  return {
    subscribed,
    tiers,
    readiness: () => readiness,
    ensureChainSubscribed: (_u: string, expiry: string, tier?: string) => {
      subscribed.push(expiry);
      tiers.push(tier);
    },
    refreshChainQuotes: async () => 0,
  };
}

function seed(store: TradfiStore, expiryTimes: number[]) {
  const insts: TradfiInstrument[] = [];
  for (const expiryTs of expiryTimes) {
    const expiry = isoDate(expiryTs);
    for (const strike of [95, 100, 105])
      for (const right of ['call', 'put'] as const) {
        const symbol = `.SPY${expiry}${strike}${right}`;
        insts.push({
          underlying: 'SPY', expiry, expiryTs, strike, right, multiplier: 100,
          occSymbol: symbol, streamerSymbol: symbol,
          canonical: `SPY/USD:USD-${expiry}-${strike}-${right === 'call' ? 'C' : 'P'}`,
          rootSymbol: 'SPY', settlementType: 'physical', expirationType: 'Regular', tickSizes: [],
        });
        const moneyness = (100 - strike) / 20;
        store.mergeQuote(symbol, {
          ts: 1, bid: 1, ask: 1.2, mark: 1.1, iv: 0.3,
          delta: right === 'call' ? 0.5 + moneyness : -0.5 + moneyness,
        });
      }
  }
  store.setInstruments(insts);
  store.setSpot('SPY', 100);
}

describe('GET /surface', () => {
  it('builds one surface row per live expiry, subscribing each and skipping expired ones', async () => {
    const now = Date.now();
    const store = new TradfiStore();
    seed(store, [now - DAY, now + 10 * DAY, now + 40 * DAY]);
    const f = feed();
    const app = buildApp({ store, feed: f });

    const res = await app.inject({ method: 'GET', url: '/surface?underlying=spy' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TradfiSurfaceResponse;
    const live = [isoDate(now + 10 * DAY), isoDate(now + 40 * DAY)];
    expect(body.underlying).toBe('SPY');
    expect(body.surface.map((row) => row.expiry)).toEqual(live);
    expect(f.subscribed).toEqual(live);
    expect(new Set(f.tiers)).toEqual(new Set(['surface']));
    expect(body.smiles.map((smile) => smile.expiry)).toEqual(live);
    expect(body.smiles[0]!.referencePriceUsd).toBe(100);
    expect(body.smiles[0]!.strikes.map((row) => row.strike)).toEqual([95, 100, 105]);
    expect(body.smiles[0]!.strikes[1]).toEqual({
      strike: 100, callIv: 0.3, callDelta: 0.5, putIv: 0.3, putDelta: -0.5,
    });
    expect(body.venueAtm.tastytrade?.map((point) => point.atm)).toEqual([0.3, 0.3]);
    expect(body.surface[0]!.dte).toBe(10);
    expect(body.venueSurfaceFineSmoothed.tastytrade).toEqual(body.surfaceFineSmoothed);
    expect(body.rv30d).toBeNull();
    expect(body.atmIvTenors['30d']).toBeCloseTo(0.3, 6);
    expect(body.atmIv30d).toBe(body.atmIvTenors['30d']);
    await app.close();
  });

  it('adds 21-day realized vol and the IV − RV spread from daily candles', async () => {
    const now = Date.now();
    const store = new TradfiStore();
    seed(store, [now + 10 * DAY, now + 40 * DAY]);
    // Alternating ±1% closes realize 0.01 × √252 over every window.
    const bars = Array.from({ length: 30 }, (_, i) => {
      const c = 100 * Math.exp(i % 2 === 0 ? 0 : 0.01);
      return { symbol: 'SPY{=d}', flags: 0, time: i * DAY, o: c, h: c, l: c, c, v: 1, iv: 0.2 };
    });
    const candleClient = { isReady: () => true, getCandles: async () => bars } as unknown as CandleClient;
    const app = buildApp({ store, feed: feed(), candleClient });

    const body = (await app.inject({ method: 'GET', url: '/surface?underlying=SPY' })).json() as TradfiSurfaceResponse;
    const rv = 0.01 * Math.sqrt(252);
    expect(body.rv30d).toBeCloseTo(rv, 10);
    expect(body.vrp30d).toBeCloseTo(0.3 - rv, 6);
    await app.close();
  });

  it('rebuilds a still-warming surface quickly instead of caching it for the full TTL', async () => {
    const now = Date.now();
    const store = new TradfiStore();
    seed(store, [now + 10 * DAY]);
    const expiry = isoDate(now + 10 * DAY);
    for (const inst of store.instrumentsFor('SPY', expiry)) store.clearQuoteFields(inst.streamerSymbol, ['iv']);
    const app = buildApp({ store, feed: feed() });

    const first = (await app.inject({ method: 'GET', url: '/surface?underlying=SPY' })).json() as TradfiSurfaceResponse;
    expect(first.smiles[0]!.strikes).toEqual([]);
    for (const inst of store.instrumentsFor('SPY', expiry)) store.mergeQuote(inst.streamerSymbol, { iv: 0.3, ts: 2 });
    await new Promise((r) => setTimeout(r, 600));
    const second = (await app.inject({ method: 'GET', url: '/surface?underlying=SPY' })).json() as TradfiSurfaceResponse;
    expect(second.smiles[0]!.strikes).toHaveLength(3);
    await app.close();
  });

  it('404s for an underlying the catalog does not list', async () => {
    const store = new TradfiStore();
    seed(store, [Date.now() + 10 * DAY]);
    const f = feed();
    const app = buildApp({ store, feed: f });
    const res = await app.inject({ method: 'GET', url: '/surface?underlying=NOPE' });
    expect(res.statusCode).toBe(404);
    expect(f.subscribed).toEqual([]);
    await app.close();
  });

  it('400s without an underlying and 503s before the catalog loads', async () => {
    const store = new TradfiStore();
    const missing = buildApp({ store, feed: feed() });
    expect((await missing.inject({ method: 'GET', url: '/surface' })).statusCode).toBe(400);
    await missing.close();
    const loading = buildApp({ store, feed: feed(false) });
    expect((await loading.inject({ method: 'GET', url: '/surface?underlying=SPY' })).statusCode).toBe(503);
    await loading.close();
  });
});
