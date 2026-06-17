import { describe, expect, it } from 'vitest';
import type { TradfiInstrument } from '../tastytrade/instrument.js';
import { buildCandlesResponse, buildUnderlyingCandlesResponse, mapRawCandle } from './candles.js';
import type { RawCandle } from '../tastytrade/candle-codec.js';
import { TradfiStore } from './store.js';

const inst: TradfiInstrument = {
  underlying: 'SPX',
  expiry: '2026-06-23',
  strike: 7555,
  right: 'call',
  occSymbol: 'SPX   260623C07555000',
  streamerSymbol: '.SPXW260623C7555',
  canonical: 'SPX/USD:USD-260623-7555-C',
  multiplier: 100,
  rootSymbol: 'SPXW',
  settlementType: 'cash',
  expirationType: 'Weekly',
};

describe('buildCandlesResponse', () => {
  it('resolves the streamer symbol and maps raw bars to the candle payload', async () => {
    const store = new TradfiStore();
    store.setInstruments([inst]);
    const fakeClient = {
      getCandles: async () => [
        {
          symbol: '.SPXW260623C7555',
          flags: 0,
          time: 1781553000000,
          o: 55.9,
          h: 56.1,
          l: 55.8,
          c: 56.0,
          v: 3,
        },
      ],
    };
    const res = await buildCandlesResponse(
      fakeClient as Parameters<typeof buildCandlesResponse>[0],
      store,
      {
        underlying: 'SPX',
        expiry: '2026-06-23',
        strike: 7555,
        right: 'call',
        interval: '5m',
        range: '7d',
        nowMs: 1_700_000_000_000,
      },
    );
    expect(res).not.toBeNull();
    expect(res!.symbol).toBe('.SPXW260623C7555');
    expect(res!.priceCurrency).toBe('USD');
    expect(res!.candles).toEqual([
      { ts: 1781553000000, o: 55.9, h: 56.1, l: 55.8, c: 56.0, vol: 3, synthetic: false },
    ]);
  });

  it('returns null when no instrument matches', async () => {
    const store = new TradfiStore();
    store.setInstruments([inst]);
    const res = await buildCandlesResponse(
      { getCandles: async () => [] } as Parameters<typeof buildCandlesResponse>[0],
      store,
      {
        underlying: 'SPX',
        expiry: '2026-06-23',
        strike: 9999,
        right: 'call',
        interval: '5m',
        range: '7d',
        nowMs: 1,
      },
    );
    expect(res).toBeNull();
  });
});

describe('buildUnderlyingCandlesResponse', () => {
  const rawBars = [
    {
      symbol: 'SPY{=1h}',
      flags: 0,
      time: 1_700_000_000_000,
      o: 500,
      h: 505,
      l: 499,
      c: 503,
      v: 10,
    },
    {
      symbol: 'SPY{=1h}',
      flags: 0,
      time: 1_700_003_600_000,
      o: 503,
      h: 507,
      l: 502,
      c: 506,
      v: 12,
    },
  ];

  it('fetches candles for the plain underlying symbol and maps them to USD', async () => {
    const calls: Array<{ symbol: string; period: string; fromTimeSec: number }> = [];
    const client = {
      getCandles: async (symbol: string, period: string, fromTimeSec: number) => {
        calls.push({ symbol, period, fromTimeSec });
        return rawBars;
      },
    };
    const res = await buildUnderlyingCandlesResponse(
      client as Parameters<typeof buildUnderlyingCandlesResponse>[0],
      { underlying: 'SPY', interval: '1h', range: '7d', nowMs: 1_700_004_000_000 },
    );
    // fromTimeSec = floor((nowMs − 7d) / 1000) = floor((1_700_004_000_000 − 604_800_000)/1000).
    expect(calls).toEqual([{ symbol: 'SPY', period: '1h', fromTimeSec: 1_699_399_200 }]);
    expect(res.symbol).toBe('SPY');
    expect(res.priceCurrency).toBe('USD');
    expect(res.candles).toHaveLength(2);
    expect(res.candles[0]).toMatchObject({
      ts: 1_700_000_000_000,
      o: 500,
      h: 505,
      l: 499,
      c: 503,
      vol: 10,
      synthetic: false,
    });
    expect(res.markLine).toEqual([]);
  });

  it('drops bars with non-finite OHLC or ts, and clamps negative volume', async () => {
    const client = {
      getCandles: async () => [
        { symbol: 'SPY{=1h}', flags: 0, time: 1, o: NaN, h: 1, l: 1, c: 1, v: 0 }, // bad OHLC → dropped
        { symbol: 'SPY{=1h}', flags: 0, time: NaN, o: 1, h: 1, l: 1, c: 1, v: 0 }, // bad ts → dropped
        { symbol: 'SPY{=1h}', flags: 0, time: -5, o: 1, h: 1, l: 1, c: 1, v: 0 }, // negative ts → dropped
        { symbol: 'SPY{=1h}', flags: 0, time: 2, o: 1, h: 1, l: 1, c: 1, v: -3 }, // negative vol → clamped
      ],
    };
    const res = await buildUnderlyingCandlesResponse(
      client as Parameters<typeof buildUnderlyingCandlesResponse>[0],
      { underlying: 'SPY', interval: '1h', range: '1d', nowMs: 1000 },
    );
    expect(res.candles).toHaveLength(1);
    expect(res.candles[0]!.ts).toBe(2);
    expect(res.candles[0]!.vol).toBe(0);
  });
});

function raw(over: Partial<RawCandle> = {}): RawCandle {
  return { symbol: 'SPX{=5m}', flags: 0, time: 1781553000000, o: 55.9, h: 56.1, l: 55.8, c: 56.0, v: 3, ...over };
}

describe('mapRawCandle', () => {
  it('maps a finite bar to a DTO', () => {
    expect(mapRawCandle(raw())).toEqual({ ts: 1781553000000, o: 55.9, h: 56.1, l: 55.8, c: 56.0, vol: 3, synthetic: false });
  });
  it('returns null for a non-finite close', () => {
    expect(mapRawCandle(raw({ c: Number.NaN }))).toBeNull();
  });
  it('clamps a negative/NaN volume to 0', () => {
    expect(mapRawCandle(raw({ v: Number.NaN }))?.vol).toBe(0);
    expect(mapRawCandle(raw({ v: -5 }))?.vol).toBe(0);
  });
});
