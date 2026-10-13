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

  it('unsubscribes chains nobody requested for 5 minutes, keeping requested ones', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    rest.getQuoteToken = vi.fn(async () => ({ token: 'QT', dxlinkUrl: 'wss://x', expiresAt: null }));
    const { fakeDx, factory } = fakeDxFactory();
    const feed = new TradfiFeed(rest as never, store, ['AAPL'], factory);
    await feed.loadMarkets();
    await feed.startStreaming();

    feed.ensureChainSubscribed('AAPL', '2026-04-17');
    const subs = fakeDx.subscribe.mock.calls[0]![0];
    expect(feed.evictIdleChains(Date.now() + 4 * 60_000)).toBe(0);
    expect(fakeDx.unsubscribe).not.toHaveBeenCalled();

    expect(feed.evictIdleChains(Date.now() + 6 * 60_000)).toBe(1);
    expect(fakeDx.unsubscribe).toHaveBeenCalledWith(subs);

    fakeDx.subscribe.mockClear();
    feed.ensureChainSubscribed('AAPL', '2026-04-17');
    expect(fakeDx.subscribe).toHaveBeenCalledWith(subs);
    await feed.dispose();
  });

  it('streams quote-only symbols without loading their chains', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    rest.getQuoteToken = vi.fn(async () => ({ token: 'QT', dxlinkUrl: 'wss://x', expiresAt: null }));
    const { fakeDx } = fakeDxFactory();
    let desired: () => { type: string; symbol: string }[] = () => [];
    const factory = (opts: { desiredSubs: typeof desired }) => {
      desired = opts.desiredSubs;
      return fakeDx as never;
    };
    const feed = new TradfiFeed(rest as never, store, ['AAPL'], factory as never);
    feed.watchQuotes(['AAPL', 'XOM']);
    await feed.loadMarkets();
    await feed.startStreaming();

    expect(rest.getNestedChain).toHaveBeenCalledTimes(1);
    expect(new Set(desired().map((s) => s.symbol))).toEqual(new Set(['AAPL', 'XOM']));

    feed.watchQuotes(['XOM', 'CVX']);
    expect(fakeDx.subscribe).toHaveBeenCalledWith([
      { type: 'Quote', symbol: 'CVX' },
      { type: 'Trade', symbol: 'CVX' },
      { type: 'Summary', symbol: 'CVX' },
    ]);
    await feed.dispose();
  });

  it('retries with backoff after a failed connection (never dies silently)', async () => {
    vi.useFakeTimers();
    try {
      const store = new TradfiStore();
      const rest = stubRest();
      rest.getQuoteToken = vi.fn(async () => ({ token: 'QT', dxlinkUrl: 'wss://x', expiresAt: null }));
      let connects = 0;
      const factory = () => ({
        connect: vi.fn(async () => { connects += 1; if (connects === 1) throw new Error('connect failed'); }),
        subscribe: vi.fn(), unsubscribe: vi.fn(), disconnect: vi.fn(async () => {}),
        isStreaming: vi.fn(() => connects > 1),
      }) as never;
      const feed = new TradfiFeed(rest as never, store, ['AAPL'], factory);
      await feed.loadMarkets();

      await feed.startStreaming(); // attempt 1 throws → backoff retry scheduled, does not rethrow
      expect(connects).toBe(1);
      expect(feed.readiness().streaming).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000); // BASE backoff fires → attempt 2 succeeds
      expect(connects).toBe(2);
      expect(feed.readiness().streaming).toBe(true);

      await feed.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

function wideRest(strikes: number[], expiries = ['2026-12-18']) {
  const rest = stubRest();
  rest.getNestedChain = vi.fn(async (symbol: string) => ({
    items: [{
      'underlying-symbol': symbol, 'root-symbol': symbol, 'shares-per-contract': 100,
      expirations: expiries.map((exp) => ({
        'expiration-date': exp, 'settlement-type': 'Physical',
        strikes: strikes.map((k) => ({
          'strike-price': `${k}.0`,
          call: `${symbol}${exp}C${k}`, put: `${symbol}${exp}P${k}`,
          'call-streamer-symbol': `.${symbol}${exp}C${k}`, 'put-streamer-symbol': `.${symbol}${exp}P${k}`,
        })),
      })),
    }],
  }));
  rest.getQuoteToken = vi.fn(async () => ({ token: 'QT', dxlinkUrl: 'wss://x', expiresAt: null }));
  return rest;
}

async function streamingFeed(rest: ReturnType<typeof stubRest>, opts: { maxSubscriptions?: number } = {}) {
  const store = new TradfiStore();
  const { fakeDx } = fakeDxFactory();
  let rejected: (detail: string) => void = () => {};
  const factory = (o: { onSubscriptionRejected: (d: string) => void }) => {
    rejected = o.onSubscriptionRejected;
    return fakeDx as never;
  };
  const feed = new TradfiFeed(rest as never, store, ['SPX'], factory as never, opts);
  await feed.loadMarkets();
  await feed.startStreaming();
  store.setSpot('SPX', 6500);
  return { feed, store, fakeDx, reject: (d: string) => rejected(d) };
}

const strikeRange = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

describe('TradfiFeed subscription tiers and budget', () => {
  it('subscribes the surface tier as greeks on sampled strikes, and upgrades to full by diff', async () => {
    const { feed, fakeDx } = await streamingFeed(wideRest(strikeRange(5000, 8000, 5)));

    feed.ensureChainSubscribed('SPX', '2026-12-18', 'surface');
    const surfaceSubs = fakeDx.subscribe.mock.calls[0]![0] as { type: string }[];
    expect(new Set(surfaceSubs.map((s) => s.type))).toEqual(new Set(['Greeks']));
    expect(surfaceSubs.length).toBeLessThanOrEqual(120);

    fakeDx.subscribe.mockClear();
    feed.ensureChainSubscribed('SPX', '2026-12-18', 'surface');
    expect(fakeDx.subscribe).not.toHaveBeenCalled();

    feed.ensureChainSubscribed('SPX', '2026-12-18', 'full');
    const added = fakeDx.subscribe.mock.calls[0]![0] as { type: string; symbol: string }[];
    expect(added).toHaveLength(601 * 2 * 4 - surfaceSubs.length);
    expect(feed.subscriptionStats().subscriptions).toBe(3 + 601 * 2 * 4);
    await feed.dispose();
  });

  it('drops an idle full tier back to the surface tier and clears its stale quote fields', async () => {
    const strikes = strikeRange(5000, 8000, 5);
    const { feed, store, fakeDx } = await streamingFeed(wideRest(strikes));
    feed.ensureChainSubscribed('SPX', '2026-12-18', 'full');
    const t0 = Date.now();
    const calls = strikes.map((k) => `.SPX2026-12-18C${k}`);
    for (const sym of calls) store.mergeQuote(sym, { bid: 1, ask: 2, iv: 0.3, ts: t0 });
    feed.ensureChainSubscribed('SPX', '2026-12-18', 'surface');
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 4 * 60_000);
    feed.ensureChainSubscribed('SPX', '2026-12-18', 'surface');
    vi.restoreAllMocks();

    expect(feed.evictIdleChains(t0 + 6 * 60_000)).toBe(0);
    expect(fakeDx.unsubscribe).toHaveBeenCalledTimes(1);
    expect(feed.subscriptionStats()).toMatchObject({ chains: 1 });
    expect(feed.subscriptionStats().subscriptions).toBeLessThanOrEqual(3 + 120);
    // Quotes stopped streaming everywhere; greeks survive only on the sampled strikes.
    expect(calls.every((sym) => store.getQuote(sym)!.bid == null)).toBe(true);
    const liveIv = calls.filter((sym) => store.getQuote(sym)!.iv != null).length;
    expect(liveIv).toBeGreaterThan(0);
    expect(liveIv).toBeLessThanOrEqual(60);
    await feed.dispose();
  });

  it('defers a chain that does not fit while others are in use, then admits it once they idle', async () => {
    const expiries = ['2026-12-18', '2027-01-15'];
    const { feed, fakeDx } = await streamingFeed(wideRest(strikeRange(6000, 7000, 5), expiries), {
      maxSubscriptions: 3 + 201 * 2 * 4,
    });
    feed.ensureChainSubscribed('SPX', expiries[0]!, 'full');
    fakeDx.subscribe.mockClear();

    feed.ensureChainSubscribed('SPX', expiries[1]!, 'full');
    expect(fakeDx.subscribe).not.toHaveBeenCalled();
    expect(feed.subscriptionStats().deferredChains).toBe(1);

    // First chain idle past the active window but within its lease: evictable for room.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60_000);
    feed.ensureChainSubscribed('SPX', expiries[1]!, 'full');
    vi.restoreAllMocks();
    expect(fakeDx.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fakeDx.subscribe).toHaveBeenCalledTimes(1);
    expect(feed.subscriptionStats()).toMatchObject({ chains: 1, deferredChains: 0 });
    await feed.dispose();
  });

  it('lowers the budget and resyncs when DXLink says the subscription set is too big', async () => {
    vi.useFakeTimers();
    try {
      const { feed, fakeDx, reject } = await streamingFeed(wideRest(strikeRange(5000, 8000, 5)));
      const resubscribeAll = vi.fn();
      Object.assign(fakeDx, { resubscribeAll });
      feed.ensureChainSubscribed('SPX', '2026-12-18', 'full');
      const before = feed.subscriptionStats().subscriptions;

      reject('Your subscription size is too big');
      reject('Your subscription size is too big');
      const stats = feed.subscriptionStats();
      expect(stats.rejects).toBe(2);
      expect(stats.budget).toBe(10_000);
      expect(before).toBeLessThan(10_000);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(resubscribeAll).toHaveBeenCalledTimes(1);
      await feed.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses the REST fallback after a 403 instead of retrying it on every request', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    rest.getMarketData = vi.fn(async () => {
      throw new Error('tastytrade GET /market-data/by-type -> 403 {}');
    });
    const feed = new TradfiFeed(rest as never, store, ['AAPL']);
    await feed.loadMarkets();
    expect(await feed.refreshChainQuotes('AAPL', '2026-04-17')).toBe(0);
    expect(rest.getMarketData).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    expect(await feed.refreshChainQuotes('AAPL', '2026-04-17')).toBe(0);
    vi.restoreAllMocks();
    expect(rest.getMarketData).toHaveBeenCalledTimes(1);
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
