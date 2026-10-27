import { describe, expect, it } from 'vitest';
import { atrChannel, type ChannelCandle } from './atr-channel';

const candle = (i: number, close = 100): ChannelCandle => ({ time: i * 300, open: close, high: close + 1, low: close - 1, close });

describe('atrChannel', () => {
  it('plots both requested presets from candle volatility without any gamma data', () => {
    const candles = Array.from({ length: 200 }, (_, i) => candle(i));
    expect(atrChannel(candles, 60, 3, 300)[60]).toEqual({ time: 18_000, basis: 100, atr: 2, upper: 106, lower: 94 });
    expect(atrChannel(candles, 130, 4, 300)[130]).toEqual({ time: 39_000, basis: 100, atr: 2, upper: 108, lower: 92 });
  });

  it('does not move a candle boundary when that candle changes', () => {
    const candles = Array.from({ length: 62 }, (_, i) => candle(i));
    const previous = atrChannel(candles, 60, 3, 300);
    candles[61] = { ...candle(61), high: 1000, low: 1, close: 500 };
    expect(atrChannel(candles, 60, 3, 300)[61]).toEqual(previous[61]);
  });

  it('includes price gaps in true range and uses Wilder smoothing for ATR', () => {
    const candles = [candle(0), candle(1), candle(2, 110), candle(3, 110)];
    expect(atrChannel(candles, 2, 4, 300)[3]?.atr).toBe(6.5);
    expect(atrChannel(candles, 2, 4, 300)[3]?.basis).toBeCloseTo(106.6666667);
  });

  it('breaks and rewarms after missing candles', () => {
    const points = atrChannel([candle(0), candle(1), candle(2), candle(5), candle(6), candle(7)], 2, 3, 300);
    expect(points.map(p => p.basis)).toEqual([null, null, 100, null, null, 100]);
  });

  it('rejects unusable parameters', () => {
    expect(() => atrChannel([], 0, 3, 300)).toThrow(RangeError);
    expect(() => atrChannel([], 60, Number.NaN, 300)).toThrow(RangeError);
  });
});
