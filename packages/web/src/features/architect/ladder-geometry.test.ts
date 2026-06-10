import { describe, it, expect } from 'vitest';
import type { Leg } from './payoff';
import {
  derivePriceDomain,
  makePriceScale,
} from './ladder-geometry';

function makeLeg(over: Partial<Leg> = {}): Leg {
  return {
    id: 'leg-1',
    type: 'call',
    direction: 'buy',
    strike: 100,
    expiry: '2026-12-25',
    quantity: 1,
    entryPrice: 3,
    venue: 'deribit',
    delta: 0.5,
    gamma: 0.01,
    theta: -0.1,
    vega: 0.2,
    iv: 0.5,
    ...over,
  };
}

describe('makePriceScale', () => {
  it('maps priceMax to padTop and priceMin to padTop+plotH (price runs up)', () => {
    const s = makePriceScale(90, 110, 20, 200);
    expect(s.y(110)).toBeCloseTo(20);
    expect(s.y(90)).toBeCloseTo(220);
    expect(s.y(100)).toBeCloseTo(120);
  });

  it('priceAt is the inverse of y', () => {
    const s = makePriceScale(90, 110, 20, 200);
    expect(s.priceAt(20)).toBeCloseTo(110);
    expect(s.priceAt(220)).toBeCloseTo(90);
    expect(s.priceAt(s.y(103.7))).toBeCloseTo(103.7);
  });

  it('does not divide by zero when domain is degenerate', () => {
    const s = makePriceScale(100, 100, 20, 200);
    expect(Number.isFinite(s.y(100))).toBe(true);
  });
});

describe('derivePriceDomain', () => {
  it('uses the payoff points range when present', () => {
    const d = derivePriceDomain(
      [
        { underlyingPrice: 80, pnl: -3 },
        { underlyingPrice: 130, pnl: 27 },
      ],
      100,
    );
    expect(d.priceMin).toBe(80);
    expect(d.priceMax).toBe(130);
  });

  it('falls back to a spot-relative window when there are no points', () => {
    const d = derivePriceDomain([], 100);
    expect(d.priceMin).toBeCloseTo(90);
    expect(d.priceMax).toBeCloseTo(110);
  });

  it('never returns a negative priceMin', () => {
    const d = derivePriceDomain([], 0.5);
    expect(d.priceMin).toBeGreaterThanOrEqual(0);
  });
});

// makeLeg is reused by later tasks in this file.
export {};
