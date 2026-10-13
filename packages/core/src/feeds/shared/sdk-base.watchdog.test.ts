import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REST_QUOTE, SdkBaseAdapter, type CachedInstrument, type LiveQuote } from './sdk-base.js';
import type { StreamHandlers, VenueCapabilities } from './types.js';
import type { VenueId } from '../../types/common.js';
import { EMPTY_GREEKS, type VenueStatus } from '../../core/types.js';

const QUOTE_STALE_MS = 3 * 60 * 1000;

class WatchdogAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'okx';
  override readonly capabilities: VenueCapabilities = {
    optionChain: true,
    greeks: true,
    websocket: true,
  };

  snapshot = { connected: true, lastActivityAt: 0, connectedAt: 0 };
  restarts = 0;

  protected initClients(): void {}
  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    return [];
  }
  protected async subscribeChain(): Promise<void> {}
  protected async unsubscribeAll(): Promise<void> {}

  protected override getFeedConnectionSnapshot() {
    return this.snapshot;
  }

  protected override restartFeedFromWatchdog(): void {
    this.restarts += 1;
  }

  markLoaded(): void {
    this.marketsLoaded = true;
  }

  setEagerExpiryCount(count: number): void {
    this.eagerExpiryCount = count;
  }

  disableQuoteWatchdog(): void {
    this.quoteStalenessThresholdMs = null;
  }

  addHandler(handlers: StreamHandlers): void {
    this.deltaHandlers.add(handlers);
  }

  publishQuote(): void {
    this.emitQuoteUpdates([{ exchangeSymbol: 'BTC-X', quote: makeQuote() }]);
  }

  publishRestQuote(): void {
    this.emitQuoteUpdates([{ exchangeSymbol: 'BTC-X', quote: makeQuote() }], REST_QUOTE);
  }

  addInstrument(): void {
    const instrument: CachedInstrument = {
      symbol: 'BTC/USD:USDT-260327-70000-C',
      exchangeSymbol: 'BTC-X',
      base: 'BTC',
      quote: 'USDT',
      settle: 'USDT',
      expiry: '2026-03-27',
      strike: 70_000,
      right: 'call',
      inverse: false,
      contractSize: 1,
      tickSize: 0.1,
      minQty: 0.1,
      makerFee: 0.0002,
      takerFee: 0.0005,
    };
    this.instruments.push(instrument);
    this.instrumentMap.set(instrument.exchangeSymbol, instrument);
    this.symbolIndex.set(instrument.symbol, instrument.exchangeSymbol);
  }

  async liveBid(): Promise<number | null> {
    const chain = await this.fetchOptionChain({
      underlying: 'BTC',
      expiry: '2026-03-27',
      venues: ['okx'],
    });
    return Object.values(chain.contracts)[0]?.quote.bid.usd ?? null;
  }

  check(): void {
    (this as unknown as { checkFeedLiveness(): void }).checkFeedLiveness();
  }
}

function makeQuote(): LiveQuote {
  return {
    bidPrice: 1,
    askPrice: 2,
    markPrice: 1.5,
    lastPrice: null,
    bidSize: 1,
    askSize: 1,
    underlyingPrice: 70_000,
    indexPrice: 70_000,
    volume24h: null,
    openInterest: null,
    openInterestUsd: null,
    volume24hUsd: null,
    greeks: { ...EMPTY_GREEKS },
    timestamp: Date.now(),
  };
}

function setup(): { adapter: WatchdogAdapter; statuses: VenueStatus[] } {
  const adapter = new WatchdogAdapter();
  const statuses: VenueStatus[] = [];
  adapter.addHandler({ onDelta: () => {}, onStatus: (status) => statuses.push(status) });
  adapter.markLoaded();
  adapter.snapshot = { connected: true, lastActivityAt: Date.now(), connectedAt: Date.now() };
  return { adapter, statuses };
}

describe('SdkBaseAdapter quote-level watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('restarts a venue whose heartbeats stay fresh after quotes stop', () => {
    const { adapter, statuses } = setup();
    adapter.publishQuote();

    vi.advanceTimersByTime(QUOTE_STALE_MS);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();

    expect(adapter.restarts).toBe(1);
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting' });
    expect(statuses.at(-1)?.message).toMatch(/no quotes/);
  });

  it('does not let REST refreshes mask a stream that stopped quoting', () => {
    const { adapter } = setup();
    adapter.publishQuote();

    vi.advanceTimersByTime(QUOTE_STALE_MS - 1_000);
    adapter.publishRestQuote();
    vi.advanceTimersByTime(1_000);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();

    expect(adapter.restarts).toBe(1);
  });

  it('leaves a venue alone while quotes keep arriving', () => {
    const { adapter } = setup();
    adapter.publishQuote();

    vi.advanceTimersByTime(QUOTE_STALE_MS - 1_000);
    adapter.publishQuote();
    vi.advanceTimersByTime(QUOTE_STALE_MS - 1_000);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();

    expect(adapter.restarts).toBe(0);
  });

  it('gives a freshly reconnected socket a full window before judging it', () => {
    const { adapter } = setup();
    adapter.publishQuote();

    vi.advanceTimersByTime(QUOTE_STALE_MS * 2);
    adapter.snapshot = { connected: true, lastActivityAt: Date.now(), connectedAt: Date.now() };
    adapter.check();

    expect(adapter.restarts).toBe(0);
  });

  it('does not restart again until another full window passes', () => {
    const { adapter } = setup();
    adapter.publishQuote();

    vi.advanceTimersByTime(QUOTE_STALE_MS);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();
    vi.advanceTimersByTime(30_000);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();
    expect(adapter.restarts).toBe(1);

    vi.advanceTimersByTime(QUOTE_STALE_MS);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();
    expect(adapter.restarts).toBe(2);
  });

  it('ignores venues that never delivered a quote', () => {
    const { adapter } = setup();

    vi.advanceTimersByTime(QUOTE_STALE_MS * 2);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();

    expect(adapter.restarts).toBe(0);
  });

  it('ignores venues with nothing subscribed upstream', () => {
    const { adapter } = setup();
    adapter.setEagerExpiryCount(0);
    adapter.publishQuote();

    vi.advanceTimersByTime(QUOTE_STALE_MS * 2);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();

    expect(adapter.restarts).toBe(0);
  });

  it('skips venues that opt out with their own staleness logic', () => {
    const { adapter } = setup();
    adapter.disableQuoteWatchdog();
    adapter.publishQuote();

    vi.advanceTimersByTime(QUOTE_STALE_MS * 2);
    adapter.snapshot.lastActivityAt = Date.now();
    adapter.check();

    expect(adapter.restarts).toBe(0);
  });

  it('skips the quote check while the socket is disconnected', () => {
    const { adapter } = setup();
    adapter.publishQuote();

    vi.advanceTimersByTime(QUOTE_STALE_MS * 2);
    adapter.snapshot = { connected: false, lastActivityAt: Date.now(), connectedAt: 0 };
    adapter.check();

    expect(adapter.restarts).toBe(0);
  });
});

describe('SdkBaseAdapter disconnected quote cutoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  function adapterWithQuote(): WatchdogAdapter {
    const { adapter } = setup();
    adapter.addInstrument();
    adapter.publishQuote();
    return adapter;
  }

  it('keeps serving quotes through a short reconnect blip', async () => {
    const adapter = adapterWithQuote();
    adapter.snapshot = { connected: false, lastActivityAt: Date.now(), connectedAt: 0 };

    vi.advanceTimersByTime(20_000);

    expect(await adapter.liveBid()).not.toBeNull();
  });

  it('stops serving pre-drop quotes once the socket has been down past the grace', async () => {
    const adapter = adapterWithQuote();
    adapter.snapshot = { connected: false, lastActivityAt: Date.now(), connectedAt: 0 };

    vi.advanceTimersByTime(31_000);

    expect(await adapter.liveBid()).toBeNull();
  });

  it('serves quotes again after reconnecting', async () => {
    const adapter = adapterWithQuote();
    adapter.snapshot = { connected: false, lastActivityAt: Date.now(), connectedAt: 0 };
    vi.advanceTimersByTime(31_000);

    adapter.snapshot = { connected: true, lastActivityAt: Date.now(), connectedAt: Date.now() };

    expect(await adapter.liveBid()).not.toBeNull();
  });
});
