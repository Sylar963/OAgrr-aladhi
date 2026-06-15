import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { TradfiStore } from './runtime/store.js';
import type { TradfiInstrument } from './tastytrade/instrument.js';

const inst: TradfiInstrument = {
  underlying: 'AAPL', expiry: '2026-04-17', strike: 200, right: 'call',
  occSymbol: 'AAPLC', streamerSymbol: '.AAPL200C', canonical: 'AAPL/USD:USD-260417-200-C',
  multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
};

function seededDeps() {
  const store = new TradfiStore();
  store.setInstruments([inst]);
  store.setSpot('AAPL', 198);
  store.mergeQuote('.AAPL200C', { bid: 5, ask: 5.2, mark: 5.1, iv: 0.4, ts: 1 });
  const feed = { isLoaded: () => true };
  return { store, feed: feed as never };
}

describe('tradfi app', () => {
  it('GET /underlyings', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: '/underlyings' });
    expect(res.statusCode).toBe(200);
    expect(res.json().underlyings).toEqual(['AAPL']);
    await app.close();
  });

  it('GET /expiries', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: '/expiries?underlying=AAPL' });
    expect(res.json().expiries).toEqual(['2026-04-17']);
    await app.close();
  });

  it('GET /chains returns an enriched chain', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: '/chains?underlying=AAPL&expiry=2026-04-17' });
    expect(res.statusCode).toBe(200);
    expect(res.json().underlying).toBe('AAPL');
    expect(Array.isArray(res.json().strikes)).toBe(true);
    await app.close();
  });

  it('GET /chains 400 without params', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: '/chains' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /chains 503 when feed not loaded', async () => {
    const store = new TradfiStore();
    const app = buildApp({ store, feed: { isLoaded: () => false } as never });
    const res = await app.inject({ method: 'GET', url: '/chains?underlying=AAPL&expiry=2026-04-17' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
