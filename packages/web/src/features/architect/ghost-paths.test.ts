import { describe, it, expect } from 'vitest';
import { buildPathCandles, WICK_PCT, computeGhostPaths } from './ghost-paths';
import type { GhostPath } from './ghost-paths';
import type { Leg } from './payoff';

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
    const paths = computeGhostPaths([leg()], 100, EXPIRY_90D, ANCHOR, RES);
    expect(paths.map((p) => p.kind)).toEqual(['up', 'down', 'theta']);
    expect(byKind(paths, 'up').isProfit).toBe(true);
    expect(byKind(paths, 'down').isProfit).toBe(false);
    expect(byKind(paths, 'theta').isProfit).toBe(false);
  });

  it('long straddle: both moves win, flat loses (theta red)', () => {
    const legs = [leg({ type: 'call' }), leg({ id: 'l2', type: 'put' })];
    const paths = computeGhostPaths(legs, 100, EXPIRY_90D, ANCHOR, RES);
    expect(byKind(paths, 'up').isProfit).toBe(true);
    expect(byKind(paths, 'down').isProfit).toBe(true);
    expect(byKind(paths, 'theta').isProfit).toBe(false);
  });

  it('short strangle: both moves lose, flat earns (theta green = sell-vol flip)', () => {
    const legs = [
      leg({ type: 'call', direction: 'sell', strike: 110, entryPrice: 3 }),
      leg({ id: 'l2', type: 'put', direction: 'sell', strike: 90, entryPrice: 3 }),
    ];
    const paths = computeGhostPaths(legs, 100, EXPIRY_90D, ANCHOR, RES);
    expect(byKind(paths, 'up').isProfit).toBe(false);
    expect(byKind(paths, 'down').isProfit).toBe(false);
    expect(byKind(paths, 'theta').isProfit).toBe(true);
  });

  it('caps the target band near 1 sigma (~spot*iv*sqrt(T))', () => {
    const paths = computeGhostPaths([leg()], 100, EXPIRY_90D, ANCHOR, RES);
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(129.79, 1);
    expect(byKind(paths, 'down').targetPrice).toBeCloseTo(70.21, 1);
  });

  it('applies the visibility floor near expiry', () => {
    const paths = computeGhostPaths([leg()], 100, 3_600_000, ANCHOR, 300);
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(101.5, 5);
  });

  it('falls back to DEFAULT_IV when no leg reports iv', () => {
    const paths = computeGhostPaths([leg({ iv: null })], 100, EXPIRY_90D, ANCHOR, RES);
    expect(paths).toHaveLength(3);
    expect(byKind(paths, 'up').targetPrice).toBeCloseTo(129.79, 1);
  });

  it('returns [] for empty legs', () => {
    expect(computeGhostPaths([], 100, EXPIRY_90D, ANCHOR, RES)).toEqual([]);
  });
});
