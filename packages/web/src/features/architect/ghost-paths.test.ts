import { describe, it, expect } from 'vitest';
import {
  WICK_PCT,
  computeGhostPaths,
  pickFractalShape,
  buildFractalPathOnTimes,
  projectionTimesOnGrid,
  pathTexture,
  realizedVol,
  FRACTAL_SHAPE_POINTS,
} from './ghost-paths';
import type { GhostPath } from './ghost-paths';
import type { Leg } from './payoff';
import type { SpotCandle } from './queries';

const DAY_MS = 86_400_000;

const dailyTimes = (days: number) => Array.from({ length: days }, (_, i) => (i + 1) * DAY_MS);

describe('buildFractalPathOnTimes (untextured)', () => {
  it('walks one bar per time from spot to target, ascending', () => {
    const candles = buildFractalPathOnTimes(100, 130, 0, 90 * DAY_MS, dailyTimes(90), []);
    expect(candles).toHaveLength(90);
    expect(candles[0]!.open).toBe(100);
    expect(candles.at(-1)!.close).toBeCloseTo(130, 5);
    expect(candles[44]!.close).toBeCloseTo(100 + (130 - 100) * (45 / 90), 4);
  });

  it('keeps a flat (theta) path visible via the wick floor', () => {
    const c = buildFractalPathOnTimes(100, 100, 0, 7 * DAY_MS, dailyTimes(7), [])[0]!;
    expect(c.open).toBe(c.close);
    expect(c.high - c.low).toBeCloseTo(2 * 100 * WICK_PCT, 6);
  });

  it('returns [] for a non-positive span', () => {
    expect(buildFractalPathOnTimes(100, 130, 1000, 1000, [2000], [])).toEqual([]);
  });

  it('re-trends a real shape onto the target, keeping wiggle but pinning endpoints', () => {
    const shape = Array.from({ length: FRACTAL_SHAPE_POINTS }, (_, i) =>
      0.05 * Math.sin((Math.PI * i) / (FRACTAL_SHAPE_POINTS - 1)),
    );
    const candles = buildFractalPathOnTimes(100, 130, 0, 90 * DAY_MS, dailyTimes(90), shape);
    expect(candles.at(-1)!.close).toBeCloseTo(130, 4);
    expect(candles[44]!.close).toBeGreaterThan(100 + (130 - 100) * (45 / 90));
  });

  it('a breakout on the flat theta target round-trips back to spot', () => {
    const shape = Array.from({ length: FRACTAL_SHAPE_POINTS }, (_, i) =>
      0.1 * Math.sin((Math.PI * i) / (FRACTAL_SHAPE_POINTS - 1)),
    );
    const candles = buildFractalPathOnTimes(100, 100, 0, 90 * DAY_MS, dailyTimes(90), shape);
    expect(candles.at(-1)!.close).toBeCloseTo(100, 4);
    expect(Math.max(...candles.map((c) => c.high))).toBeGreaterThan(105);
  });

  it('pins the target for bars past expiry', () => {
    const candles = buildFractalPathOnTimes(100, 130, 0, 10, [5, 10, 15], []);
    expect(candles.map((c) => c.close)).toEqual([115, 130, 130]);
  });
});

describe('buildFractalPathOnTimes (textured)', () => {
  const HOUR_MS = 3_600_000;
  const hourly = Array.from({ length: 24 * 14 }, (_, i) => (i + 1) * HOUR_MS);
  const build = (seedAnchor = 0) =>
    buildFractalPathOnTimes(100, 110, 0, 14 * DAY_MS, hourly, [], pathTexture('up', 0.6, seedAnchor));

  it('is deterministic for the same seed and differs across seeds', () => {
    expect(build()).toEqual(build());
    expect(build(DAY_MS).map((c) => c.close)).not.toEqual(build().map((c) => c.close));
  });

  it('still lands exactly on the target at expiry', () => {
    expect(build().at(-1)!.close).toBeCloseTo(110, 8);
  });

  it('produces mixed-colour bodies and uneven wicks sized near realized vol', () => {
    const candles = build();
    const ups = candles.filter((c) => c.close > c.open).length;
    expect(ups).toBeGreaterThan(candles.length * 0.3);
    expect(ups).toBeLessThan(candles.length * 0.8);
    const upperWicks = candles.map((c) => c.high - Math.max(c.open, c.close));
    expect(new Set(upperWicks.map((w) => w.toFixed(4))).size).toBeGreaterThan(candles.length / 2);
    // 60% vol on 1H bars ≈ 0.64% per bar; bodies should be of that order, not 10×.
    const meanBody = candles.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / candles.length;
    expect(meanBody).toBeGreaterThan(0.2);
    expect(meanBody).toBeLessThan(1.5);
  });

  it('decorrelates path kinds sharing bar times', () => {
    const up = buildFractalPathOnTimes(100, 100, 0, 14 * DAY_MS, hourly, [], pathTexture('up', 0.6, 0));
    const th = buildFractalPathOnTimes(100, 100, 0, 14 * DAY_MS, hourly, [], pathTexture('theta', 0.6, 0));
    expect(up.map((c) => c.close)).not.toEqual(th.map((c) => c.close));
  });
});

describe('realizedVol', () => {
  it('annualizes close-to-close vol and returns null on thin history', () => {
    expect(realizedVol([], 3600)).toBeNull();
    // Alternating ±1% hourly moves ≈ 1% per bar → ~0.94 annualized.
    const closes = Array.from({ length: 200 }, (_, i) => (i % 2 ? 101 : 100));
    const h = closes.map((c, i) => ({ timestamp: i, open: c, high: c, low: c, close: c }));
    expect(realizedVol(h, 3600)).toBeCloseTo(0.0099 * Math.sqrt(8760), 1);
  });
});

function leg(over: Partial<Leg> = {}): Leg {
  return {
    id: over.id ?? 'l1',
    type: over.type ?? 'call',
    direction: over.direction ?? 'buy',
    strike: over.strike ?? 100,
    expiry: over.expiry ?? '2026-09-01',
    quantity: over.quantity ?? 1,
    entryPrice: over.entryPrice ?? 5,
    venue: over.venue ?? 'deribit',
    delta: over.delta ?? null,
    gamma: over.gamma ?? null,
    theta: over.theta ?? null,
    vega: over.vega ?? null,
    iv: over.iv === undefined ? 0.6 : over.iv,
  };
}

const ANCHOR = 0;
const EXPIRY_90D = 90 * DAY_MS;
const RES = 86_400;
const byKind = (paths: GhostPath[], k: string) => paths.find((p) => p.kind === k)!;

describe('computeGhostPaths', () => {
  it('long call: up wins, down & flat lose', () => {
    const paths = computeGhostPaths([leg()], 100, EXPIRY_90D, ANCHOR, RES, []);
    expect(paths.map((p) => p.kind)).toEqual(['up', 'down', 'theta']);
    expect(byKind(paths, 'up').isProfit).toBe(true);
    expect(byKind(paths, 'down').isProfit).toBe(false);
    expect(byKind(paths, 'theta').isProfit).toBe(false);
  });

  it('long straddle: both moves win, flat loses (theta red)', () => {
    const legs = [leg({ type: 'call' }), leg({ id: 'l2', type: 'put' })];
    const paths = computeGhostPaths(legs, 100, EXPIRY_90D, ANCHOR, RES, []);
    expect(byKind(paths, 'up').isProfit).toBe(true);
    expect(byKind(paths, 'down').isProfit).toBe(true);
    expect(byKind(paths, 'theta').isProfit).toBe(false);
  });

  it('short strangle: both moves lose, flat earns (theta green = sell-vol flip)', () => {
    const legs = [
      leg({ type: 'call', direction: 'sell', strike: 110, entryPrice: 3 }),
      leg({ id: 'l2', type: 'put', direction: 'sell', strike: 90, entryPrice: 3 }),
    ];
    const paths = computeGhostPaths(legs, 100, EXPIRY_90D, ANCHOR, RES, []);
    expect(byKind(paths, 'up').isProfit).toBe(false);
    expect(byKind(paths, 'down').isProfit).toBe(false);
    expect(byKind(paths, 'theta').isProfit).toBe(true);
  });

  it('caps the target band near 1 sigma (~spot*iv*sqrt(T))', () => {
    const paths = computeGhostPaths([leg()], 100, EXPIRY_90D, ANCHOR, RES, []);
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(129.79, 1);
    expect(byKind(paths, 'down').targetPrice).toBeCloseTo(70.21, 1);
  });

  it('applies the visibility floor near expiry', () => {
    const paths = computeGhostPaths([leg()], 100, 3_600_000, ANCHOR, 300, []);
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(101.5, 5);
  });

  it('falls back to DEFAULT_IV when no leg reports iv', () => {
    const paths = computeGhostPaths([leg({ iv: null })], 100, EXPIRY_90D, ANCHOR, RES, []);
    expect(paths).toHaveLength(3);
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(129.79, 1);
  });

  it('returns [] for empty legs', () => {
    expect(computeGhostPaths([], 100, EXPIRY_90D, ANCHOR, RES, [])).toEqual([]);
  });
});

function hist(closes: number[]): SpotCandle[] {
  return closes.map((c, i) => ({ timestamp: i * DAY_MS, open: c, high: c, low: c, close: c }));
}

describe('fractal shapes', () => {
  it('pickFractalShape returns a fixed-length residual anchored at both ends', () => {
    const h = hist(Array.from({ length: 60 }, (_, i) => 100 + 5 * Math.sin(i / 4)));
    const shape = pickFractalShape(h, 'up', 90);
    expect(shape).toHaveLength(FRACTAL_SHAPE_POINTS);
    expect(shape[0]!).toBeCloseTo(0, 6);
    expect(shape.at(-1)!).toBeCloseTo(0, 6);
  });

  it('returns a flat (zero) shape when history is too thin', () => {
    expect(pickFractalShape([], 'up', 90)).toEqual(new Array(FRACTAL_SHAPE_POINTS).fill(0));
    expect(pickFractalShape(hist([100]), 'down', 90)).toEqual(
      new Array(FRACTAL_SHAPE_POINTS).fill(0),
    );
  });

  it('breakout picks a wilder window than range', () => {
    const calm = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 0.2 : -0.2));
    const wild = Array.from({ length: 40 }, (_, i) => 100 + 25 * Math.sin(i / 5));
    const h = hist([...calm, ...wild]);
    const breakout = Math.max(...pickFractalShape(h, 'breakout', 40).map(Math.abs));
    const range = Math.max(...pickFractalShape(h, 'range', 40).map(Math.abs));
    expect(breakout).toBeGreaterThan(range);
  });

  it('computeGhostPaths sources each path from real history and pins endpoints', () => {
    const h = hist(Array.from({ length: 100 }, (_, i) => 100 + 6 * Math.sin(i / 7)));
    const paths = computeGhostPaths([leg()], 100, EXPIRY_90D, ANCHOR, RES, h);
    for (const p of paths) {
      expect(p.shape).toHaveLength(FRACTAL_SHAPE_POINTS);
      expect(p.candles[0]!.open).toBeCloseTo(100, 6);
      expect(p.candles.at(-1)!.close).toBeCloseTo(p.targetPrice, 3);
    }
  });
});

describe('projectionTimesOnGrid', () => {
  const HOUR_MS = 3_600_000;

  it('steps on the resolution grid when there is no history', () => {
    expect(projectionTimesOnGrid(0, 3 * HOUR_MS, 3600, [])).toEqual([
      HOUR_MS,
      2 * HOUR_MS,
      3 * HOUR_MS,
    ]);
  });

  it('a 4H snapshot replayed on a 1H chart lands on every real candle, then continues hourly', () => {
    const real = Array.from({ length: 10 }, (_, i) => i * HOUR_MS);
    const times = projectionTimesOnGrid(4 * HOUR_MS, 14 * HOUR_MS, 3600, real);
    expect(times).toEqual(Array.from({ length: 10 }, (_, i) => (i + 5) * HOUR_MS));
  });

  it('a 1H snapshot replayed on a 4H chart adds no time points between real candles', () => {
    const real = Array.from({ length: 6 }, (_, i) => i * 4 * HOUR_MS);
    const anchor = 5 * HOUR_MS; // off the 4H grid
    const times = projectionTimesOnGrid(anchor, 30 * HOUR_MS, 4 * 3600, real);
    const realSet = new Set(real);
    const pastTimes = times.filter((t) => t <= real.at(-1)!);
    expect(pastTimes.every((t) => realSet.has(t))).toBe(true);
    expect(times.at(-1)).toBeGreaterThanOrEqual(30 * HOUR_MS);
    expect(times.every((t, i) => i === 0 || (t - times[i - 1]!) % (4 * HOUR_MS) === 0)).toBe(true);
  });

  it('follows real gaps (e.g. weekends) instead of filling them', () => {
    const real = [0, HOUR_MS, 50 * HOUR_MS, 51 * HOUR_MS];
    expect(projectionTimesOnGrid(0, 52 * HOUR_MS, 3600, real)).toEqual([
      HOUR_MS,
      50 * HOUR_MS,
      51 * HOUR_MS,
      52 * HOUR_MS,
    ]);
  });
});
