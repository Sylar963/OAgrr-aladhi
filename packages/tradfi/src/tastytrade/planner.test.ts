import { describe, expect, it } from 'vitest';
import type { TradfiInstrument } from './instrument.js';
import {
  chainSubscriptions, planChainSubscriptions, sampleSurfaceStrikes, SURFACE_MAX_STRIKES,
  underlyingSubscriptions,
} from './planner.js';

const NOW = Date.parse('2026-10-13T15:00:00Z');

function chain(strikes: number[], days = 30): TradfiInstrument[] {
  const expiryTs = NOW + days * 86_400_000;
  return strikes.flatMap((strike) =>
    (['call', 'put'] as const).map((right) => ({
      underlying: 'SPX', expiry: '2026-11-12', expiryTs, strike, right, multiplier: 100,
      occSymbol: `${strike}${right}`, streamerSymbol: `.SPX${strike}${right[0]}`,
      canonical: `SPX-${strike}-${right}`, rootSymbol: 'SPX', settlementType: 'cash',
      expirationType: 'Regular', tickSizes: [],
    })),
  );
}

const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

describe('planner', () => {
  it('expands streamer symbols into 4 event subs each', () => {
    const subs = chainSubscriptions(['.AAPL200C', '.AAPL200P']);
    expect(subs).toHaveLength(8);
    expect(subs.filter((s) => s.symbol === '.AAPL200C').map((s) => s.type).sort())
      .toEqual(['Greeks', 'Quote', 'Summary', 'Trade']);
  });

  it('subscribes underlyings to Quote+Trade+Summary', () => {
    const subs = underlyingSubscriptions(['AAPL']);
    expect(subs.map((s) => s.type).sort()).toEqual(['Quote', 'Summary', 'Trade']);
  });

  it('keeps every strike of a short chain', () => {
    expect(sampleSurfaceStrikes([90, 100, 110], 100, 0.1)).toEqual([90, 100, 110]);
  });

  it('samples a dense chain densely near the money and out into both wings', () => {
    const strikes = range(1000, 10_000, 5);
    const picked = sampleSurfaceStrikes(strikes, 6500, 7 / 365);
    expect(picked.length).toBeLessThanOrEqual(SURFACE_MAX_STRIKES);
    expect(picked.length).toBeGreaterThan(SURFACE_MAX_STRIKES / 2);
    expect(picked).toContain(6500);
    const near = picked.filter((k) => Math.abs(k - 6500) <= 130).length;
    const far = picked.filter((k) => Math.abs(k - 6500) > 130 && Math.abs(k - 6500) <= 260).length;
    expect(near).toBeGreaterThan(far);
    expect(Math.min(...picked)).toBeLessThan(6500 * 0.5);
    expect(Math.max(...picked)).toBeGreaterThan(6500 * 1.4);
    // Strikes past the log-moneyness band carry no IV and are never sampled.
    expect(Math.min(...picked)).toBeGreaterThanOrEqual(6500 * Math.exp(-1.2));
  });

  it('plans greeks-only subscriptions on sampled strikes for the surface tier', () => {
    const insts = chain(range(5000, 8000, 5));
    const subs = planChainSubscriptions(insts, ['surface'], 6500, NOW);
    expect(new Set(subs.map((s) => s.type))).toEqual(new Set(['Greeks']));
    expect(subs.length).toBeLessThanOrEqual(2 * SURFACE_MAX_STRIKES);
  });

  it('unions tiers without duplicating a symbol/event pair', () => {
    const insts = chain(range(5000, 8000, 5));
    const full = planChainSubscriptions(insts, ['full'], 6500, NOW);
    const both = planChainSubscriptions(insts, ['full', 'surface'], 6500, NOW);
    expect(both).toEqual(full);
    expect(new Set(both.map((s) => `${s.type}|${s.symbol}`)).size).toBe(both.length);
  });
});
