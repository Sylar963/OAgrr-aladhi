import { describe, expect, it } from 'vitest';
import { realizedVol, rollingRealizedVol } from './realized-vol.js';

describe('realizedVol — close-to-close zero-mean annualized', () => {
  it('returns 0 for a constant price series (no movement → no vol)', () => {
    expect(realizedVol([100, 100, 100, 100, 100], 365)).toBe(0);
  });

  it('matches hand-computed RV for a symmetric ±5% oscillation', () => {
    // closes alternate 100 → 105 → 100 → 105 → 100, daily candles.
    // Each log-return r_i has |r_i| = ln(1.05) ≈ 0.0487902.
    // RV = sqrt(mean(r²)) × √365 = 0.0487902 × √365 ≈ 0.93214 (≈ 93% annualized).
    const closes = [100, 105, 100, 105, 100];
    expect(realizedVol(closes, 365)).toBeCloseTo(0.93214, 4);
  });

  it('matches hand-computed RV for hourly candles', () => {
    // Single 1% jump on hourly candles → ln(1.01) × √(365×24) ≈ 0.00995 × 93.59 ≈ 0.9314.
    const closes = [100, 101];
    expect(realizedVol(closes, 365 * 24)).toBeCloseTo(0.9314, 3);
  });

  it('returns null for fewer than two closes (no return computable)', () => {
    expect(realizedVol([], 365)).toBeNull();
    expect(realizedVol([100], 365)).toBeNull();
  });

  it('returns null for non-positive periodsPerYear', () => {
    expect(realizedVol([100, 101], 0)).toBeNull();
    expect(realizedVol([100, 101], -365)).toBeNull();
  });

  it('returns null when any close is non-positive or non-finite', () => {
    expect(realizedVol([100, 0, 100], 365)).toBeNull();
    expect(realizedVol([100, NaN, 100], 365)).toBeNull();
    expect(realizedVol([100, Infinity, 100], 365)).toBeNull();
    expect(realizedVol([-100, 100], 365)).toBeNull();
  });
});

describe('rollingRealizedVol — trailing-window series', () => {
  const c = (timestamp: number, close: number) => ({ timestamp, close });

  it('returns [] when there are not more candles than the window', () => {
    expect(rollingRealizedVol([], 30, 365)).toEqual([]);
    // 31 candles are needed for the first 30-day window; 30 is one short.
    const short = Array.from({ length: 30 }, (_, i) => c(i, 100 + i));
    expect(rollingRealizedVol(short, 30, 365)).toEqual([]);
  });

  it('returns [] for a non-positive window', () => {
    expect(rollingRealizedVol([c(1, 100), c(2, 105)], 0, 365)).toEqual([]);
  });

  it('stamps each trailing-window RV at the closing candle (hand-computed)', () => {
    // window=2 → each point uses 3 closes / 2 returns, |r| = ln(1.05) ≈ 0.0487902,
    // so RV = ln(1.05) × √365 ≈ 0.93214 for both windows.
    const candles = [c(1, 100), c(2, 105), c(3, 100), c(4, 105)];
    const series = rollingRealizedVol(candles, 2, 365);
    expect(series).toHaveLength(2);
    expect(series[0]!.timestamp).toBe(3);
    expect(series[1]!.timestamp).toBe(4);
    expect(series[0]!.value).toBeCloseTo(0.93214, 4);
    expect(series[1]!.value).toBeCloseTo(0.93214, 4);
  });

  it('emits one ascending point per candle beyond the window', () => {
    const candles = Array.from({ length: 40 }, (_, i) => c(i, 100 + (i % 2)));
    const series = rollingRealizedVol(candles, 30, 365);
    expect(series).toHaveLength(10);
    expect(series.map((p) => p.timestamp)).toEqual([30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);
  });
});
