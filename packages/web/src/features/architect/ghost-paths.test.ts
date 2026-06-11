import { describe, it, expect } from 'vitest';
import { buildPathCandles, WICK_PCT } from './ghost-paths';

const DAY_MS = 86_400_000;

describe('buildPathCandles', () => {
  it('walks one bar per bucket from spot to target, ascending', () => {
    const candles = buildPathCandles(100, 130, 0, 90 * DAY_MS, 86_400);
    expect(candles).toHaveLength(90);
    expect(candles[0]!.open).toBe(100);
    expect(candles.at(-1)!.close).toBeCloseTo(130, 5);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.timestamp).toBeGreaterThan(candles[i - 1]!.timestamp);
    }
  });

  it('keeps a flat (theta) path visible via the wick floor', () => {
    const candles = buildPathCandles(100, 100, 0, 7 * DAY_MS, 86_400);
    const c = candles[0]!;
    expect(c.open).toBe(c.close);
    expect(c.high - c.low).toBeCloseTo(2 * 100 * WICK_PCT, 6);
    expect(c.high).toBeGreaterThan(c.low);
  });

  it('returns [] for a non-positive span', () => {
    expect(buildPathCandles(100, 130, 1000, 1000, 86_400)).toEqual([]);
  });
});
