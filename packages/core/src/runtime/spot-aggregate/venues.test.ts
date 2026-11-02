import { describe, expect, it, vi } from 'vitest';
import { AGGREGATED_SPOT_UNDERLYINGS } from '@oggregator/protocol';
import {
  parseDeribitTicker,
  sourceResolution,
  SPOT_VENUES,
  spotLegs,
  type SpotFetch,
} from './venues.js';

// Frames captured live on 2026-11-02; references/ has no spot channels to copy from.
const FRAMES = {
  binance: '{"e":"kline","E":1793643460033,"s":"BTCUSDT","k":{"t":1793643420000,"T":1793643479999,"s":"BTCUSDT","i":"1m","f":6812775642,"L":6812777153,"o":"77224.01000000","c":"77262.01000000","h":"77276.01000000","l":"77224.01000000","v":"4.09614000","n":1512,"x":false,"q":"316445.71818760","V":"2.99925000","Q":"231690.91034760","B":"0"}}',
  bybit: '{"type":"snapshot","topic":"kline.1.BTCUSDT","data":[{"start":1793643420000,"end":1793643479999,"interval":"1","open":"77211.7","close":"77249.8","high":"77262.6","low":"77211.7","volume":"6.346969","turnover":"490279.7716147","confirm":false,"timestamp":1793643457563}],"ts":1793643457563}',
  okx: '{"arg":{"channel":"candle1m","instId":"BTC-USDT"},"data":[["1793643420000","77215.5","77270.7","77215.5","77246.9","3.07381448","237421.090234696","237421.090234696","0"]]}',
  gateio: '{"time":1793643459,"time_ms":1793643459159,"channel":"spot.candlesticks","event":"update","result":{"t":"1793643420","v":"397201.9768596","c":"77251.1","h":"77271.5","l":"77213.4","o":"77213.4","n":"1m_BTC_USDT","a":"5.141609","w":false}}',
  coinbase: '{"type":"match","trade_id":1114031787,"maker_order_id":"7213ce58-5fad-41bd-8586-f7175d246478","taker_order_id":"69c22b0b-720a-4519-aabe-5282ba08e86e","side":"sell","size":"0.00315007","price":"77115.89","product_id":"BTC-USD","sequence":138675692110,"time":"2026-11-02T18:17:38.020751Z"}',
  hyperliquid: '{"channel":"candle","data":{"t":1793643420000,"T":1793643479999,"s":"@107","i":"1m","o":"84.273","c":"84.303","h":"84.322","l":"84.272","v":"431.63","n":61}}',
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

function respondWith(body: unknown): SpotFetch {
  return vi.fn(async () => new Response(JSON.stringify(body))) as unknown as SpotFetch;
}

describe('stream frames', () => {
  it('reads base volume and the bar start from each kline stream', () => {
    expect(SPOT_VENUES.binance.parse(FRAMES.binance)).toEqual([
      {
        kind: 'bar',
        symbol: 'BTCUSDT',
        resolutionSec: 60,
        bar: { timestamp: 1793643420000, open: 77224.01, high: 77276.01, low: 77224.01, close: 77262.01, volume: 4.09614 },
      },
    ]);
    expect(SPOT_VENUES.bybit.parse(FRAMES.bybit)).toEqual([
      {
        kind: 'bar',
        symbol: 'BTCUSDT',
        resolutionSec: 60,
        bar: { timestamp: 1793643420000, open: 77211.7, high: 77262.6, low: 77211.7, close: 77249.8, volume: 6.346969 },
      },
    ]);
    expect(SPOT_VENUES.okx.parse(FRAMES.okx)).toEqual([
      {
        kind: 'bar',
        symbol: 'BTC-USDT',
        resolutionSec: 60,
        bar: { timestamp: 1793643420000, open: 77215.5, high: 77270.7, low: 77215.5, close: 77246.9, volume: 3.07381448 },
      },
    ]);
    expect(SPOT_VENUES.hyperliquid.parse(FRAMES.hyperliquid)).toEqual([
      {
        kind: 'bar',
        symbol: '@107',
        resolutionSec: 60,
        bar: { timestamp: 1793643420000, open: 84.273, high: 84.322, low: 84.272, close: 84.303, volume: 431.63 },
      },
    ]);
  });

  it('uses Gate base volume, not its quote-denominated v field', () => {
    const [event] = SPOT_VENUES.gateio.parse(FRAMES.gateio);
    expect(event).toEqual({
      kind: 'bar',
      symbol: 'BTC_USDT',
      resolutionSec: 60,
      bar: { timestamp: 1793643420000, open: 77213.4, high: 77271.5, low: 77213.4, close: 77251.1, volume: 5.141609 },
    });
  });

  it('turns Coinbase matches into ticks', () => {
    expect(SPOT_VENUES.coinbase.parse(FRAMES.coinbase)).toEqual([
      {
        kind: 'tick',
        symbol: 'BTC-USD',
        timestamp: Date.parse('2026-11-02T18:17:38.020751Z'),
        price: 77115.89,
        size: 0.00315007,
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
    expect(SPOT_VENUES.binance.parse('{"result":null,"id":1}')).toEqual([]);
    expect(SPOT_VENUES.okx.parse('pong')).toEqual([]);
    expect(SPOT_VENUES.bybit.parse('{"success":true,"op":"subscribe"}')).toEqual([]);
    expect(SPOT_VENUES.hyperliquid.parse('{"channel":"pong"}')).toEqual([]);
    expect(SPOT_VENUES.coinbase.parse('{"type":"heartbeat","product_id":"BTC-USD"}')).toEqual([]);
  });
});

describe('history pages', () => {
  it('maps Gate rows, whose close comes before high, low and open', async () => {
    const fetchImpl = respondWith([
      ['1793643480', '231431.653105', '77239.2', '77251.4', '77228.7', '77228.8', '2.99624', 'false'],
    ]);
    await expect(SPOT_VENUES.gateio.fetchPage(fetchImpl, 'BTC_USDT', '1m', 0, 1)).resolves.toEqual([
      { timestamp: 1793643480000, open: 77228.8, high: 77251.4, low: 77228.7, close: 77239.2, volume: 2.99624 },
    ]);
  });

  it('maps Coinbase rows, whose low comes before high', async () => {
    const fetchImpl = respondWith([[1793643240, 77102.75, 77173.99, 77165.44, 77111.27, 15.65262384]]);
    await expect(SPOT_VENUES.coinbase.fetchPage(fetchImpl, 'BTC-USD', '60', 0, 1)).resolves.toEqual([
      { timestamp: 1793643240000, open: 77165.44, high: 77173.99, low: 77102.75, close: 77111.27, volume: 15.65262384 },
    ]);
  });

  it('maps Deribit columns', async () => {
    const fetchImpl = respondWith({
      result: {
        status: 'ok',
        ticks: [1793642820000],
        open: [77244],
        high: [77245],
        low: [77164],
        close: [77164],
        volume: [20.4971073],
        cost: [1582570],
      },
    });
    await expect(SPOT_VENUES.deribit.fetchPage(fetchImpl, 'BTC_USDC', '1', 0, 1)).resolves.toEqual([
      { timestamp: 1793642820000, open: 77244, high: 77245, low: 77164, close: 77164, volume: 20.4971073 },
    ]);
  });

  it('maps OKX and Binance rows and rejects venue errors', async () => {
    const okxRow = ['1793643480000', '77225.2', '77255.8', '77223.2', '77245.1', '2.17090218', '167681.65', '167681.65', '0'];
    await expect(SPOT_VENUES.okx.fetchPage(respondWith({ code: '0', data: [okxRow], msg: '' }), 'BTC-USDT', '1m', 0, 1)).resolves.toEqual([
      { timestamp: 1793643480000, open: 77225.2, high: 77255.8, low: 77223.2, close: 77245.1, volume: 2.17090218 },
    ]);
    await expect(SPOT_VENUES.okx.fetchPage(respondWith({ code: '51001', data: [], msg: 'no instrument' }), 'X', '1m', 0, 1)).rejects.toThrow('51001');

    const binanceRow = [1793643480000, '77230.01', '77262.01', '77230', '77262', '1.4954', 1793643539999, '115508.55', 1312, '1.34', '104204.52', '0'];
    await expect(SPOT_VENUES.binance.fetchPage(respondWith([binanceRow]), 'BTCUSDT', '1m', 0, 1)).resolves.toEqual([
      { timestamp: 1793643480000, open: 77230.01, high: 77262.01, low: 77230, close: 77262, volume: 1.4954 },
    ]);
  });
});

describe('sourceResolution', () => {
  it('rolls up the bars Deribit and Coinbase do not offer', () => {
    expect(sourceResolution('deribit', 14400)).toBe(3600);
    expect(sourceResolution('coinbase', 14400)).toBe(3600);
    expect(sourceResolution('coinbase', 1800)).toBe(900);
    expect(sourceResolution('deribit', 86400)).toBe(3600);
  });

  it('uses native bars everywhere else', () => {
    expect(sourceResolution('deribit', 1800)).toBe(1800);
    expect(sourceResolution('okx', 14400)).toBe(14400);
    expect(sourceResolution('hyperliquid', 86400)).toBe(86400);
  });
});

describe('spotLegs', () => {
  it('covers every underlying with at least two venues', () => {
    for (const underlying of AGGREGATED_SPOT_UNDERLYINGS) {
      expect(spotLegs(underlying).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('puts BTC on all seven venues', () => {
    expect(spotLegs('BTC').map((leg) => leg.venue)).toEqual([
      'deribit',
      'binance',
      'bybit',
      'okx',
      'gateio',
      'coinbase',
      'hyperliquid',
    ]);
  });

  it('treats the USDC chain underlyings as the same asset', () => {
    expect(spotLegs('BTC_USDC')).toEqual(spotLegs('BTC'));
    expect(spotLegs('ETH_USDC')).toEqual(spotLegs('ETH'));
  });

  it('marks which pairs need USDT conversion', () => {
    const quotes = Object.fromEntries(spotLegs('BTC').map((leg) => [leg.venue, leg.quote]));
    expect(quotes).toMatchObject({ deribit: 'USD', coinbase: 'USD', hyperliquid: 'USD', binance: 'USDT', okx: 'USDT' });
  });

  it('leaves out the same-ticker tokens that are different assets', () => {
    expect(spotLegs('TRUMP').map((leg) => leg.venue)).not.toContain('hyperliquid');
    expect(spotLegs('LIT').map((leg) => leg.venue)).not.toContain('binance');
  });
});
