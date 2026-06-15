import { describe, expect, it, vi } from 'vitest';
import { TradfiFeed } from './feed.js';
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

describe('TradfiFeed (REST)', () => {
  it('loads markets and lists underlyings', async () => {
    const store = new TradfiStore();
    const feed = new TradfiFeed(stubRest() as never, store, ['AAPL']);
    await feed.loadMarkets();
    expect(store.listUnderlyings()).toEqual(['AAPL']);
    expect(store.instrumentsFor('AAPL', '2026-04-17')).toHaveLength(2);
  });

  it('refreshes chain quotes from market-data and sets spot', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    const feed = new TradfiFeed(rest as never, store, ['AAPL']);
    await feed.loadMarkets();
    await feed.refreshChainQuotes('AAPL', '2026-04-17');
    expect(store.getQuote('.AAPL200C')!.bid).toBe(5);
    expect(rest.getMarketData).toHaveBeenCalled();
    expect(store.getSpot('AAPL')).toBe(198);
  });

  it('connects DXLink and subscribes all loaded chains + underlyings', async () => {
    const store = new TradfiStore();
    const rest = stubRest();
    rest.getQuoteToken = vi.fn(async () => ({ token: 'QT', dxlinkUrl: 'wss://x', expiresAt: null }));
    const subscribed: unknown[] = [];
    const fakeDx = {
      connect: vi.fn(async () => {}),
      subscribe: vi.fn((subs: unknown) => subscribed.push(subs)),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(async () => {}),
    };
    const feed = new TradfiFeed(rest as never, store, ['AAPL'], () => fakeDx as never);
    await feed.loadMarkets();
    await feed.startStreaming();
    expect(rest.getQuoteToken).toHaveBeenCalled();
    expect(fakeDx.connect).toHaveBeenCalled();
  });
});
