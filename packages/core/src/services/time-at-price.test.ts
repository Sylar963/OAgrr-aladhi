import { describe, expect, it } from 'vitest';
import { buildTimeAtPrice, niceStep, type TimeAtPriceCandle } from './time-at-price.js';

const HOUR_MS = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);

function bar(i: number, low: number, high: number, close = (low + high) / 2): TimeAtPriceCandle {
  return { timestamp: T0 + i * HOUR_MS, low, high, close };
}

const baseOptions = {
  fromTs: T0,
  volWindowBars: 2,
  barsPerYear: 365 * 24,
  targetLevels: 10,
  targetVolBins: 2,
};

describe('niceStep', () => {
  it('rounds up to a 1/2/2.5/5 step', () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(180)).toBe(200);
    expect(niceStep(240)).toBe(250);
    expect(niceStep(3100)).toBe(5000);
    expect(niceStep(0)).toBe(1);
  });
});

describe('buildTimeAtPrice', () => {
  it('counts the bars whose range contains each level, edges included', () => {
    const profile = buildTimeAtPrice(
      [bar(0, 100, 110), bar(1, 105, 120), bar(2, 100, 100.5)],
      baseOptions,
    )!;
    expect(profile.binSize).toBe(2);
    const at = (price: number) => profile.levels.find((l) => l.price === price)?.bars;
    expect(at(100)).toBe(2);
    expect(at(106)).toBe(2);
    expect(at(110)).toBe(2);
    expect(at(112)).toBe(1);
    expect(at(120)).toBe(1);
  });

  it('averages trailing Parkinson vol by the bin of each bar mid', () => {
    const candles = [bar(0, 100, 101), bar(1, 100, 101), bar(2, 100, 101), bar(3, 200, 202)];
    const profile = buildTimeAtPrice(candles, { ...baseOptions, targetVolBins: 1 })!;
    const parkinson = (h: number, l: number) => Math.log(h / l) ** 2 / (4 * Math.LN2);
    const volOf = (vars: number[]) =>
      Math.sqrt((vars.reduce((s, v) => s + v, 0) / vars.length) * 365 * 24);

    expect(profile.volBinSize).toBe(200);
    const low = profile.volByLevel.find((b) => b.price === 0)!;
    const high = profile.volByLevel.find((b) => b.price === 200)!;
    expect(low.bars).toBe(2);
    expect(low.vol).toBeCloseTo(volOf([parkinson(101, 100), parkinson(101, 100)]), 10);
    expect(high.bars).toBe(1);
    expect(high.vol).toBeCloseTo(volOf([parkinson(101, 100), parkinson(202, 200)]), 10);
  });

  it('uses bars before fromTs only to warm up the vol window', () => {
    const candles = [bar(0, 50, 60), bar(1, 100, 101), bar(2, 100, 101)];
    const profile = buildTimeAtPrice(candles, { ...baseOptions, fromTs: T0 + HOUR_MS })!;
    expect(profile.bars).toBe(2);
    expect(profile.levels[0]!.price).toBeGreaterThanOrEqual(99);
    expect(profile.volByLevel.reduce((n, b) => n + b.bars, 0)).toBe(2);
  });

  it('keeps the last close of each UTC day', () => {
    const candles = [bar(0, 99, 101, 100), bar(23, 99, 101, 101), bar(24, 99, 103, 102)];
    const profile = buildTimeAtPrice(candles, baseOptions)!;
    expect(profile.dailyCloses).toEqual([
      { ts: T0, close: 101 },
      { ts: T0 + 24 * HOUR_MS, close: 102 },
    ]);
  });

  it('skips malformed bars and returns null when nothing is in range', () => {
    expect(buildTimeAtPrice([bar(0, 0, 10), bar(1, 12, 11)], baseOptions)).toBeNull();
  });
});
