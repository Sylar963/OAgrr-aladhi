import { describe, expect, it } from 'vitest';
import { buildApp, type FeedLike } from './app.js';
import { TradfiStore } from './runtime/store.js';
import type { TradfiReadiness } from './tastytrade/feed.js';
import type { TradfiInstrument } from './tastytrade/instrument.js';
import type { CandleClient } from './tastytrade/candle-client.js';
import type { RawCandle } from './tastytrade/candle-codec.js';

const inst: TradfiInstrument = {
  underlying: 'AAPL', expiry: '2026-04-17', strike: 200, right: 'call',
  occSymbol: 'AAPLC', streamerSymbol: '.AAPL200C', canonical: 'AAPL/USD:USD-260417-200-C',
  multiplier: 100, rootSymbol: 'AAPL', settlementType: 'physical', expirationType: 'Regular',
};

function readiness(over: Partial<TradfiReadiness> = {}): TradfiReadiness {
  return {
    catalogLoaded: true, quoteTokenAcquired: true, streaming: true,
    lastDataTs: 1, underlyings: 1, instruments: 1, ...over,
  };
}

function makeFeed(
  over: Partial<TradfiReadiness> = {},
  refresh: FeedLike['refreshChainQuotes'] = async () => 0,
): FeedLike {
  const r = readiness(over);
  return { readiness: () => r, ensureChainSubscribed: () => {}, refreshChainQuotes: refresh };
}

function seededDeps() {
  const store = new TradfiStore();
  store.setInstruments([inst]);
  store.setSpot('AAPL', 198);
  store.mergeQuote('.AAPL200C', { bid: 5, ask: 5.2, mark: 5.1, iv: 0.4, ts: 1 });
  return { store, feed: makeFeed() };
}

function makeCandleClient(bars: RawCandle[] = [], ready = true): CandleClient {
  return { isReady: () => ready, getCandles: async () => bars } as unknown as CandleClient;
}

const CANDLES_URL = '/candles?underlying=AAPL&expiry=2026-04-17&strike=200&right=call&interval=5m&range=7d';

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

  it('GET /chains 503 when catalog not loaded', async () => {
    const store = new TradfiStore();
    const app = buildApp({ store, feed: makeFeed({ catalogLoaded: false, instruments: 0 }) });
    const res = await app.inject({ method: 'GET', url: '/chains?underlying=AAPL&expiry=2026-04-17' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('catalog not loaded');
    await app.close();
  });

  it('GET /chains 503 when up with instruments but no data yet', async () => {
    const store = new TradfiStore();
    store.setInstruments([inst]); // instruments exist, but no quote merged
    const app = buildApp({ store, feed: makeFeed({ lastDataTs: 0, streaming: false }) });
    const res = await app.inject({ method: 'GET', url: '/chains?underlying=AAPL&expiry=2026-04-17' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('no market data yet');
    await app.close();
  });

  it('GET /chains 200 (empty) when the expiry has no instruments', async () => {
    const store = new TradfiStore();
    store.setInstruments([inst]);
    const app = buildApp({ store, feed: makeFeed({ lastDataTs: 0, streaming: false }) });
    const res = await app.inject({ method: 'GET', url: '/chains?underlying=AAPL&expiry=2099-01-01' });
    expect(res.statusCode).toBe(200);
    expect(res.json().strikes).toEqual([]);
    await app.close();
  });

  it('GET /chains serves after a best-effort REST refresh populates the store', async () => {
    const store = new TradfiStore();
    store.setInstruments([inst]);
    const refresh: FeedLike['refreshChainQuotes'] = async (u, e) => {
      if (u === 'AAPL' && e === '2026-04-17') {
        store.mergeQuote('.AAPL200C', { bid: 5, mark: 5.1, ts: 123 });
        return 1;
      }
      return 0;
    };
    const app = buildApp({ store, feed: makeFeed({ lastDataTs: 0, streaming: false }, refresh) });
    const res = await app.inject({ method: 'GET', url: '/chains?underlying=AAPL&expiry=2026-04-17' });
    expect(res.statusCode).toBe(200);
    expect(res.json().underlying).toBe('AAPL');
    await app.close();
  });

  it('GET /candles 400 on a non-numeric strike', async () => {
    const app = buildApp({ ...seededDeps(), candleClient: makeCandleClient() });
    const res = await app.inject({ method: 'GET', url: CANDLES_URL.replace('strike=200', 'strike=abc') });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /candles 503 when the candle client is absent', async () => {
    const app = buildApp(seededDeps());
    const res = await app.inject({ method: 'GET', url: CANDLES_URL });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('GET /candles 404 for an unknown strike', async () => {
    const app = buildApp({ ...seededDeps(), candleClient: makeCandleClient() });
    const res = await app.inject({ method: 'GET', url: CANDLES_URL.replace('strike=200', 'strike=999') });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /candles 200 maps snapshot bars for a known instrument', async () => {
    const bars: RawCandle[] = [{ symbol: '.AAPL200C{=5m}', flags: 0, time: 1781553000000, o: 5, h: 5.2, l: 4.9, c: 5.1, v: 3 }];
    const app = buildApp({ ...seededDeps(), candleClient: makeCandleClient(bars) });
    const res = await app.inject({ method: 'GET', url: CANDLES_URL });
    expect(res.statusCode).toBe(200);
    expect(res.json().symbol).toBe('.AAPL200C');
    expect(res.json().candles).toEqual([
      { ts: 1781553000000, o: 5, h: 5.2, l: 4.9, c: 5.1, vol: 3, synthetic: false },
    ]);
    await app.close();
  });

  it('GET /underlying-candles 400 without underlying', async () => {
    const app = buildApp({ ...seededDeps(), candleClient: makeCandleClient() });
    const res = await app.inject({ method: 'GET', url: '/underlying-candles?interval=1h&range=7d' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /underlying-candles 503 when the candle feed is not ready', async () => {
    const app = buildApp({ ...seededDeps(), candleClient: makeCandleClient([], false) });
    const res = await app.inject({ method: 'GET', url: '/underlying-candles?underlying=AAPL&interval=1h&range=7d' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('GET /underlying-candles 200 maps bars for a known underlying', async () => {
    const bars: RawCandle[] = [{ symbol: 'AAPL{=1h}', flags: 0, time: 1781553000000, o: 198, h: 199, l: 197, c: 198.5, v: 1000 }];
    const app = buildApp({ ...seededDeps(), candleClient: makeCandleClient(bars) });
    const res = await app.inject({ method: 'GET', url: '/underlying-candles?underlying=AAPL&interval=1h&range=7d' });
    expect(res.statusCode).toBe(200);
    expect(res.json().symbol).toBe('AAPL');
    expect(res.json().candles).toEqual([
      { ts: 1781553000000, o: 198, h: 199, l: 197, c: 198.5, vol: 1000, synthetic: false },
    ]);
    await app.close();
  });

  it('GET /health is always 200', async () => {
    const store = new TradfiStore();
    const app = buildApp({ store, feed: makeFeed({ catalogLoaded: false }) });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    expect(typeof res.json().marketOpen).toBe('boolean');
    await app.close();
  });

  it('GET /ready is 503 until catalog + fresh data, then 200', async () => {
    const notReady = buildApp({ store: new TradfiStore(), feed: makeFeed({ catalogLoaded: false, lastDataTs: 0, streaming: false }) });
    expect((await notReady.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(503);
    await notReady.close();

    // streaming + a fresh tick → ready regardless of market hours.
    const ready = buildApp({ store: new TradfiStore(), feed: makeFeed({ streaming: true, lastDataTs: Date.now() }) });
    const res = await ready.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(true);
    await ready.close();
  });

  it('GET /ready is 503 when the stream is down, even if data was once received', async () => {
    // lastDataTs > 0 must NOT mean "ready forever" — a dead stream is not ready.
    const app = buildApp({ store: new TradfiStore(), feed: makeFeed({ streaming: false, lastDataTs: Date.now() }) });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().ready).toBe(false);
    await app.close();
  });
});
