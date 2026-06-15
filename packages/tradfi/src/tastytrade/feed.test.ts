import { describe, expect, it, vi } from 'vitest';
import { TradfiFeed, computeQuoteTokenTtl } from './feed.js';
import { TradfiStore } from '../runtime/store.js';

function stubRest() {
  return {
    getNestedChain: vi.fn(async (symbol: string) => ({
      items: [{
        'underlying-symbol': symbol, 'root-symbol': symbol, 'shares-per-contract': 100,
        expirations: [{
          'expiration-date': '2026-04-17', 'settlement-type': 'Physical',
          strikes: [{
            'strike-price': '200.0',
            call: `${symbol}C`, put: `${symbol}P`,
            'call-streamer-symbol': `.${symbol}200C`, 'put-streamer-symbol': `.${symbol}200P`,
          }],
        }],
      }],
    })),
    // market-data is keyed by OCC symbol; the feed maps OCC -> instrument -> streamer symbol.
    getMarketData: vi.fn(async () => [
      { symbol: 'AAPLC', bid: 5, ask: 5.2, mark: 5.1, last: 5.1, volume: 10 },
      { symbol: 'AAPL', last: 198, mark: 198 },
    ]),
    getQuoteToken: vi.fn(),
  };
}

function fakeDxFactory() {
  const fakeDx = {
    connect: vi.fn(async () => {}),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(async () => {}),
    isStreaming: vi.fn(() => true),
  };
  return { fakeDx, factory: () => fakeDx as never };
}

describe('TradfiFeed (REST)', () => {
  it('loads markets and lists underlyings', async () => {
    const store = new TradfiStore();
    const feed = new TradfiFeed(stubRest() as never, store, ['AAPL']);
    await feed.loadMarkets();
    expect(store.listUnderlyings()).toEqual(['AAPL']);
    expect(store.instrumentsFor('AAPL', '2026-04-17')).toHaveLength(2);
    expect(feed.readiness().catalogLoaded).toBe(true);
  });

  it('catalog stays unloaded when every chain load fails', async () => {
    const rest = stubRest();
    rest.getNestedChain = vi.fn(async () => { throw new Error('403'); });
    const store = new TradfiStore();
    const feed = new TradfiFeed(rest as never, store, ['AAPL', 'NVDA']);
    await feed.loadMarkets();
    expect(feed.readiness().catalogLoaded).toBe(false);
    expect(feed.readiness().instruments).toBe(0);
  });

  it('refreshes chain quotes from market-data, sets spot, and returns a merged count', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    const feed = new TradfiFeed(rest as never, store, ['AAPL']);
    await feed.loadMarkets();
    const merged = await feed.refreshChainQuotes('AAPL', '2026-04-17');
    expect(merged).toBe(1);
    expect(store.getQuote('.AAPL200C')!.bid).toBe(5);
    expect(rest.getMarketData).toHaveBeenCalled();
    expect(store.getSpot('AAPL')).toBe(198);
  });

  it('connects DXLink and reports readiness', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    rest.getQuoteToken = vi.fn(async () => ({ token: 'QT', dxlinkUrl: 'wss://x', expiresAt: null }));
    const { fakeDx, factory } = fakeDxFactory();
    const feed = new TradfiFeed(rest as never, store, ['AAPL'], factory);
    await feed.loadMarkets();
    await feed.startStreaming();
    expect(rest.getQuoteToken).toHaveBeenCalled();
    expect(fakeDx.connect).toHaveBeenCalled();
    const r = feed.readiness();
    expect(r.quoteTokenAcquired).toBe(true);
    expect(r.streaming).toBe(true);
    await feed.dispose();
  });

  it('subscribes a chain on demand and is idempotent', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    rest.getQuoteToken = vi.fn(async () => ({ token: 'QT', dxlinkUrl: 'wss://x', expiresAt: null }));
    const { fakeDx, factory } = fakeDxFactory();
    const feed = new TradfiFeed(rest as never, store, ['AAPL'], factory);
    await feed.loadMarkets();
    await feed.startStreaming();

    feed.ensureChainSubscribed('AAPL', '2026-04-17');
    expect(fakeDx.subscribe).toHaveBeenCalledTimes(1); // 2 instruments → one batched add

    fakeDx.subscribe.mockClear();
    feed.ensureChainSubscribed('AAPL', '2026-04-17'); // already subscribed → no-op
    expect(fakeDx.subscribe).not.toHaveBeenCalled();
    await feed.dispose();
  });
});

describe('computeQuoteTokenTtl', () => {
  const now = Date.parse('2026-06-15T00:00:00Z');

  it('falls back to ~23h when expires-at is missing', () => {
    expect(computeQuoteTokenTtl(null, now)).toBe(23 * 60 * 60 * 1000);
  });

  it('falls back when expires-at is unparseable', () => {
    expect(computeQuoteTokenTtl('not-a-date', now)).toBe(23 * 60 * 60 * 1000);
  });

  it('refreshes 5 minutes before a future expiry', () => {
    const expiresAt = '2026-06-16T00:00:00Z'; // 24h out
    expect(computeQuoteTokenTtl(expiresAt, now)).toBe(24 * 60 * 60 * 1000 - 5 * 60 * 1000);
  });

  it('never schedules under a minute, even near expiry', () => {
    const expiresAt = new Date(now + 1000).toISOString();
    expect(computeQuoteTokenTtl(expiresAt, now)).toBe(60 * 1000);
  });
});
