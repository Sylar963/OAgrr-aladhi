import { describe, it, expect } from 'vitest';
import {
  buildPathCandles,
  WICK_PCT,
  computeGhostPaths,
  pickFractalShape,
  buildFractalPathCandles,
  FRACTAL_SHAPE_POINTS,
} from './ghost-paths';
import type { GhostPath } from './ghost-paths';
import type { Leg } from './payoff';
import type { SpotCandle } from './queries';

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

describe('buildFractalPathCandles', () => {
  it('a flat shape degenerates to the straight glide', () => {
    const candles = buildFractalPathCandles(100, 130, 0, 90 * DAY_MS, 86_400, []);
    expect(candles[0]!.open).toBe(100);
    expect(candles.at(-1)!.close).toBeCloseTo(130, 4);
    expect(candles[44]!.close).toBeCloseTo(100 + (130 - 100) * (45 / 90), 4);
  });

  it('re-trends a real shape onto the target, keeping wiggle but pinning endpoints', () => {
    const shape = Array.from({ length: FRACTAL_SHAPE_POINTS }, (_, i) =>
      0.05 * Math.sin((Math.PI * i) / (FRACTAL_SHAPE_POINTS - 1)),
    );
    const candles = buildFractalPathCandles(100, 130, 0, 90 * DAY_MS, 86_400, shape);
    expect(candles[0]!.open).toBeCloseTo(100, 6);
    expect(candles.at(-1)!.close).toBeCloseTo(130, 4);
    expect(candles[44]!.close).toBeGreaterThan(100 + (130 - 100) * (45 / 90));
  });

  it('a breakout on the flat theta target round-trips back to spot', () => {
    const shape = Array.from({ length: FRACTAL_SHAPE_POINTS }, (_, i) =>
      0.1 * Math.sin((Math.PI * i) / (FRACTAL_SHAPE_POINTS - 1)),
    );
    const candles = buildFractalPathCandles(100, 100, 0, 90 * DAY_MS, 86_400, shape);
    expect(candles.at(-1)!.close).toBeCloseTo(100, 4);
    expect(Math.max(...candles.map((c) => c.high))).toBeGreaterThan(105);
  });
});
