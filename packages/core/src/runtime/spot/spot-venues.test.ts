import { describe, expect, it, vi } from 'vitest';
import { AGGREGATED_SPOT_UNDERLYINGS } from '@oggregator/protocol';
import {
  parseDeribitTicker,
  sourceResolution,
  SPOT_VENUES,
  spotLegs,
  type SpotFetch,
} from './spot-venues.js';

// Frames captured live on 2026-11-02; references/ has no spot channels to copy from.
const FRAMES = {
  binance: '{"e":"kline","E":1793643460033,"s":"BTCUSDT","k":{"t":1793643420000,"T":1793643479999,"s":"BTCUSDT","i":"1m","f":6812775642,"L":6812777153,"o":"77224.01000000","c":"77262.01000000","h":"77276.01000000","l":"77224.01000000","v":"4.09614000","n":1512,"x":false,"q":"316445.71818760","V":"2.99925000","Q":"231690.91034760","B":"0"}}',
  bybit: '{"type":"snapshot","topic":"kline.1.BTCUSDT","data":[{"start":1793643420000,"end":1793643479999,"interval":"1","open":"77211.7","close":"77249.8","high":"77262.6","low":"77211.7","volume":"6.346969","turnover":"490279.7716147","confirm":false,"timestamp":1793643457563}],"ts":1793643457563}',
} as const;

const DERIBIT_TICKER = {
  timestamp: 1793643539057,
  state: 'open',
  stats: { high: 78762.3, low: 76706.86, price_change: -0.8753, volume: 6806.6625584 },
  index_price: 77099.66,
  instrument_name: 'BTC_USDC',
  last_price: 77080.5,
  min_price: 75557.66,
  max_price: 78641.66,
  mark_price: 77099.66,
  best_ask_price: 77088.1,
  best_bid_price: 77088.09,
  best_ask_amount: 0.0474,
  best_bid_amount: 0.01299325,
};

function parseFrame(venue: 'binance' | 'bybit', raw: string) {
  return SPOT_VENUES[venue].parse?.(raw) ?? [];
}

function respondWith(body: unknown): SpotFetch {
  return vi.fn(async () => new Response(JSON.stringify(body))) as unknown as SpotFetch;
}

describe('stream frames', () => {
  it('reads base volume and the bar start from each kline stream', () => {
    expect(parseFrame('binance', FRAMES.binance)).toEqual([
      {
        kind: 'bar',
        symbol: 'BTCUSDT',
        resolutionSec: 60,
        bar: { timestamp: 1793643420000, open: 77224.01, high: 77276.01, low: 77224.01, close: 77262.01, volume: 4.09614 },
      },
    ]);
    expect(parseFrame('bybit', FRAMES.bybit)).toEqual([
      {
        kind: 'bar',
        symbol: 'BTCUSDT',
        resolutionSec: 60,
        bar: { timestamp: 1793643420000, open: 77211.7, high: 77262.6, low: 77211.7, close: 77249.8, volume: 6.346969 },
      },
    ]);
  });

  it('uses the Deribit book mid so the bar does not go stale between trades', () => {
    expect(parseDeribitTicker(DERIBIT_TICKER)).toEqual([
      {
        kind: 'tick',
        symbol: 'BTC_USDC',
        timestamp: 1793643539057,
        price: 77088.095,
        size: 0,
      },
    ]);
  });

  it('skips a one-sided Deribit book', () => {
    expect(parseDeribitTicker({ ...DERIBIT_TICKER, best_bid_price: null })).toEqual([]);
  });

  it('ignores acks and pongs without throwing', () => {
    expect(parseFrame('binance', '{"result":null,"id":1}')).toEqual([]);
    expect(parseFrame('bybit', '{"success":true,"op":"subscribe"}')).toEqual([]);
  });
});

describe('history pages', () => {
  it('maps Binance and Bybit rows and rejects Bybit errors', async () => {
    const binanceRow = [1793643480000, '77230.01', '77262.01', '77230', '77262', '1.4954', 1793643539999, '115508.55', 1312, '1.34', '104204.52', '0'];
    await expect(SPOT_VENUES.binance.fetchPage(respondWith([binanceRow]), 'BTCUSDT', '1m', 0, 1)).resolves.toEqual([
      { timestamp: 1793643480000, open: 77230.01, high: 77262.01, low: 77230, close: 77262, volume: 1.4954 },
    ]);

    const bybitRow = ['1793643480000', '77221.9', '77250', '77221.9', '77249.9', '3.162753', '244272.58'];
    await expect(SPOT_VENUES.bybit.fetchPage(respondWith({ retCode: 0, result: { list: [bybitRow] } }), 'BTCUSDT', '1', 0, 1)).resolves.toEqual([
      { timestamp: 1793643480000, open: 77221.9, high: 77250, low: 77221.9, close: 77249.9, volume: 3.162753 },
    ]);
    await expect(SPOT_VENUES.bybit.fetchPage(respondWith({ retCode: 10001, retMsg: 'bad symbol', result: {} }), 'X', '1', 0, 1)).rejects.toThrow('10001');
  });
});

describe('sourceResolution', () => {
  it('rolls Deribit 4h and daily up from 1h', () => {
    expect(sourceResolution('deribit', 14400)).toBe(3600);
    expect(sourceResolution('deribit', 86400)).toBe(3600);
  });

  it('uses native bars everywhere else', () => {
    expect(sourceResolution('deribit', 1800)).toBe(1800);
    expect(sourceResolution('binance', 14400)).toBe(14400);
    expect(sourceResolution('bybit', 86400)).toBe(86400);
  });
});

describe('spotLegs', () => {
  it('covers every underlying with at least one venue', () => {
    for (const underlying of AGGREGATED_SPOT_UNDERLYINGS) {
      expect(spotLegs(underlying).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('leads BTC with Binance, then Bybit and Deribit', () => {
    expect(spotLegs('BTC').map((leg) => leg.venue)).toEqual(['binance', 'bybit', 'deribit']);
  });

  it('gives Binance the deciding votes', () => {
    expect(SPOT_VENUES.binance.weight).toBe(2);
    expect(SPOT_VENUES.bybit.weight).toBe(1);
    expect(SPOT_VENUES.deribit.weight).toBe(1);
  });

  it('treats the USDC chain underlyings as the same asset', () => {
    expect(spotLegs('BTC_USDC')).toEqual(spotLegs('BTC'));
    expect(spotLegs('ETH_USDC')).toEqual(spotLegs('ETH'));
  });

  it('marks which pairs need USDT conversion', () => {
    const quotes = Object.fromEntries(spotLegs('BTC').map((leg) => [leg.venue, leg.quote]));
    expect(quotes).toEqual({ binance: 'USDT', bybit: 'USDT', deribit: 'USD' });
  });

  it('leaves out the same-ticker token that is a different asset', () => {
    expect(spotLegs('LIT').map((leg) => leg.venue)).toEqual(['bybit']);
  });
});
