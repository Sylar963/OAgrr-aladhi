import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { TradfiStore } from '../runtime/store.js';
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
  return {
    subscribed,
    readiness: () => readiness,
    ensureChainSubscribed: (_u: string, expiry: string) => void subscribed.push(expiry),
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
    expect(body.venueAtm.tastytrade?.map((point) => point.atm)).toEqual([0.3, 0.3]);
    expect(body.surface[0]!.dte).toBe(10);
    expect(body.venueSurfaceFineSmoothed.tastytrade).toEqual(body.surfaceFineSmoothed);
    expect(body.rv30d).toBeNull();
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
