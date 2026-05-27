import { describe, expect, it, vi } from 'vitest';
import { EMPTY_GREEKS } from '../../core/types.js';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import { DeribitWsAdapter } from './ws-client.js';

interface FakeRpc {
  call: ReturnType<typeof vi.fn<(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>>>;
  connect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  subscribe: ReturnType<typeof vi.fn<(channels: string[], source?: string) => Promise<void>>>;
  unsubscribe: ReturnType<typeof vi.fn<(channels: string[]) => Promise<void>>>;
  unsubscribeAll: ReturnType<typeof vi.fn<() => Promise<void>>>;
  disconnect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  terminate: ReturnType<typeof vi.fn<() => void>>;
  isConnected: boolean;
  lastActivityAtMs: number;
  connectedAtMs: number;
  reconnectAttemptsCount: number;
  rateLimitUntilMs: number;
}

type DeribitTestInternals = {
  rpc: FakeRpc;
  activeRpc: FakeRpc;
  instruments: CachedInstrument[];
  subscriptions: {
    subscribedTickers: Set<string>;
    tickerIntervals: Map<string, string>;
  };
  quoteStore: Map<string, LiveQuote>;
  subscribedTickerStaleSince: number;
  refreshPublicStatus: () => Promise<void>;
  subscribeWithInterval: (
    underlying: string,
    instruments: CachedInstrument[],
    interval: string,
    source?: string,
  ) => Promise<void>;
  unsubscribeChain: (
    underlying: string,
    expiry: string,
    instruments: CachedInstrument[],
  ) => Promise<void>;
  checkSubscribedTickerStaleness: () => void;
};

function createFakeRpc(): FakeRpc {
  return {
    call: vi.fn(async () => ({})),
    connect: vi.fn(async () => {}),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    unsubscribeAll: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    terminate: vi.fn(),
    isConnected: true,
    lastActivityAtMs: 1,
    connectedAtMs: 1,
    reconnectAttemptsCount: 0,
    rateLimitUntilMs: 0,
  };
}

function buildInstrument(exchangeSymbol: string): CachedInstrument {
  return {
    symbol: `BTC/USD:BTC-260327-${exchangeSymbol.endsWith('-P') ? '70000-P' : '70000-C'}`,
    exchangeSymbol,
    base: 'BTC',
    quote: 'BTC',
    settle: 'BTC',
    expiry: '2026-03-27',
    expirationTimestamp: null,
    strike: 70_000,
    right: exchangeSymbol.endsWith('-P') ? 'put' : 'call',
    inverse: true,
    contractSize: 1,
    contractValueCurrency: 'BTC',
    tickSize: null,
    minQty: null,
    makerFee: null,
    takerFee: null,
  };
}

function buildStaleQuote(timestamp: number): LiveQuote {
  return {
    bidPrice: 0.1,
    askPrice: 0.11,
    bidSize: 1,
    askSize: 1,
    markPrice: 0.105,
    lastPrice: 0.105,
    underlyingPrice: 67_000,
    indexPrice: 67_000,
    volume24h: 1,
    openInterest: 1,
    openInterestUsd: 67_000,
    volume24hUsd: 67_000,
    greeks: { ...EMPTY_GREEKS, delta: 0.5, markIv: 0.5 },
    timestamp,
  };
}

describe('DeribitWsAdapter socket split', () => {
  it('routes active ticker subscriptions to the active socket and bulk coverage to background', async () => {
    const adapter = new DeribitWsAdapter();
    const internals = adapter as unknown as DeribitTestInternals;
    const backgroundRpc = createFakeRpc();
    const activeRpc = createFakeRpc();
    const instrument = buildInstrument('BTC-27MAR26-70000-C');

    internals.rpc = backgroundRpc;
    internals.activeRpc = activeRpc;
    internals.instruments = [instrument];

    await internals.subscribeWithInterval('BTC', [instrument], '100ms', 'chain');

    expect(backgroundRpc.connect).toHaveBeenCalledOnce();
    expect(backgroundRpc.subscribe).toHaveBeenCalledWith(
      ['markprice.options.btc_usd', 'deribit_price_index.btc_usd'],
      'bulk-chain',
    );
    expect(activeRpc.connect).toHaveBeenCalledOnce();
    expect(activeRpc.subscribe).toHaveBeenCalledWith(
      ['ticker.BTC-27MAR26-70000-C.100ms'],
      'ticker-chain',
    );
  });

  it('downgrades active BTC tickers back to background eager coverage on unsubscribe', async () => {
    const adapter = new DeribitWsAdapter();
    const internals = adapter as unknown as DeribitTestInternals;
    const backgroundRpc = createFakeRpc();
    const activeRpc = createFakeRpc();
    const instrument = buildInstrument('BTC-27MAR26-70000-C');

    internals.rpc = backgroundRpc;
    internals.activeRpc = activeRpc;
    internals.instruments = [instrument];
    internals.subscriptions.subscribedTickers.add(instrument.exchangeSymbol);
    internals.subscriptions.tickerIntervals.set(instrument.exchangeSymbol, '100ms');

    await internals.unsubscribeChain('BTC', '2026-03-27', [instrument]);

    expect(activeRpc.unsubscribe).toHaveBeenCalledWith(['ticker.BTC-27MAR26-70000-C.100ms']);
    expect(backgroundRpc.subscribe).toHaveBeenCalledWith(
      ['ticker.BTC-27MAR26-70000-C.agg2'],
      'ticker-downgrade',
    );
  });

  it('forces the active socket to reconnect when active subscriptions go stale', () => {
    const adapter = new DeribitWsAdapter();
    const internals = adapter as unknown as DeribitTestInternals;
    const backgroundRpc = createFakeRpc();
    const activeRpc = createFakeRpc();
    const staleTs = Date.now() - 120_000;

    internals.rpc = backgroundRpc;
    internals.activeRpc = activeRpc;
    internals.subscribedTickerStaleSince = Date.now() - 31_000;

    for (let i = 0; i < 10; i += 1) {
      const exchangeSymbol = `BTC-27MAR26-${70000 + i}-C`;
      internals.subscriptions.subscribedTickers.add(exchangeSymbol);
      internals.subscriptions.tickerIntervals.set(exchangeSymbol, '100ms');
      internals.quoteStore.set(exchangeSymbol, buildStaleQuote(staleTs));
    }

    internals.checkSubscribedTickerStaleness();

    expect(activeRpc.terminate).toHaveBeenCalledOnce();
    expect(backgroundRpc.terminate).not.toHaveBeenCalled();
  });

  it('does not reconnect the background socket for public/status timeouts while quotes stay active', async () => {
    const adapter = new DeribitWsAdapter();
    const internals = adapter as unknown as DeribitTestInternals;
    const backgroundRpc = createFakeRpc();
    const activeRpc = createFakeRpc();

    backgroundRpc.call.mockRejectedValue(
      new Error('[deribit-ws] public/status timed out after 15000ms'),
    );
    backgroundRpc.lastActivityAtMs = Date.now();
    backgroundRpc.connectedAtMs = Date.now();

    internals.rpc = backgroundRpc;
    internals.activeRpc = activeRpc;

    await internals.refreshPublicStatus();

    expect(backgroundRpc.terminate).not.toHaveBeenCalled();
  });

  it('reconnects the background socket for public/status timeouts when the feed is idle', async () => {
    const adapter = new DeribitWsAdapter();
    const internals = adapter as unknown as DeribitTestInternals;
    const backgroundRpc = createFakeRpc();
    const activeRpc = createFakeRpc();

    backgroundRpc.call.mockRejectedValue(
      new Error('[deribit-ws] public/status timed out after 15000ms'),
    );
    backgroundRpc.lastActivityAtMs = Date.now() - 60_000;
    backgroundRpc.connectedAtMs = Date.now() - 60_000;

    internals.rpc = backgroundRpc;
    internals.activeRpc = activeRpc;

    await internals.refreshPublicStatus();

    expect(backgroundRpc.terminate).toHaveBeenCalledOnce();
  });
});
