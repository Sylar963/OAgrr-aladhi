import { describe, expect, it } from 'vitest';
import { computeMetrics, type Leg } from './payoff';

function leg(overrides: Partial<Leg> & Pick<Leg, 'type' | 'direction' | 'strike' | 'entryPrice'>): Leg {
  return {
    id: `${overrides.direction}-${overrides.type}-${overrides.strike}`,
    expiry: '2026-05-29',
    quantity: 1,
    venue: 'deribit',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('bull call spread has finite max profit and max loss', () => {
    const legs: Leg[] = [
      leg({ type: 'call', direction: 'buy', strike: 78_000, entryPrice: 4_005 }),
      leg({ type: 'call', direction: 'sell', strike: 79_000, entryPrice: 3_520 }),
    ];
    const m = computeMetrics(legs, 78_000);
    // Net debit = -4005 + 3520 = -485
    expect(m.netDebit).toBeCloseTo(-485, 0);
    // Max profit = strike width - |net debit| = 1000 - 485 = 515
    expect(m.maxProfit).not.toBeNull();
    expect(m.maxProfit!).toBeCloseTo(515, 0);
    // Max loss = net debit = -485
    expect(m.maxLoss).not.toBeNull();
    expect(m.maxLoss!).toBeCloseTo(-485, 0);
  });

  it('long call has unbounded profit and finite loss', () => {
    const legs: Leg[] = [leg({ type: 'call', direction: 'buy', strike: 78_000, entryPrice: 4_000 })];
    const m = computeMetrics(legs, 78_000);
    expect(m.maxProfit).toBeNull();
    expect(m.maxLoss).not.toBeNull();
    expect(m.maxLoss!).toBeCloseTo(-4_000, 0);
  });

  it('short call has unbounded loss and finite profit', () => {
    const legs: Leg[] = [leg({ type: 'call', direction: 'sell', strike: 78_000, entryPrice: 4_000 })];
    const m = computeMetrics(legs, 78_000);
    expect(m.maxProfit).not.toBeNull();
    expect(m.maxProfit!).toBeCloseTo(4_000, 0);
    expect(m.maxLoss).toBeNull();
  });

  it('iron condor is bounded on both sides', () => {
    const legs: Leg[] = [
      leg({ type: 'put', direction: 'buy', strike: 70_000, entryPrice: 200 }),
      leg({ type: 'put', direction: 'sell', strike: 75_000, entryPrice: 400 }),
      leg({ type: 'call', direction: 'sell', strike: 82_000, entryPrice: 400 }),
      leg({ type: 'call', direction: 'buy', strike: 87_000, entryPrice: 200 }),
    ];
    const m = computeMetrics(legs, 78_000);
    expect(m.maxProfit).not.toBeNull();
    expect(m.maxLoss).not.toBeNull();
  });

  it('bear put spread (buy high strike put, sell low strike put) is bounded', () => {
    const legs: Leg[] = [
      leg({ type: 'put', direction: 'buy', strike: 78_000, entryPrice: 1_000 }),
      leg({ type: 'put', direction: 'sell', strike: 77_000, entryPrice: 600 }),
    ];
    const m = computeMetrics(legs, 78_000);
    expect(m.maxProfit).not.toBeNull();
    expect(m.maxLoss).not.toBeNull();
  });
});

describe('computeMetrics — greek partial-coverage reporting', () => {
  it('reports greeksMissingLegs=0 when every leg has every greek', () => {
    const legs: Leg[] = [
      leg({
        type: 'call', direction: 'buy', strike: 70_000, entryPrice: 100,
        delta: 0.5, gamma: 0.001, theta: -10, vega: 5,
      }),
      leg({
        type: 'call', direction: 'sell', strike: 72_000, entryPrice: 50,
        delta: 0.3, gamma: 0.0008, theta: -8, vega: 4,
      }),
    ];
    const m = computeMetrics(legs, 70_000);
    expect(m.greeksMissingLegs).toBe(0);
    expect(m.netDelta).toBeCloseTo(0.2, 5);
  });

  it('reports greeksMissingLegs=1 when one leg of an iron condor lacks delta', () => {
    const legs: Leg[] = [
      leg({
        type: 'put', direction: 'buy', strike: 60_000, entryPrice: 50,
        delta: -0.1, gamma: 0.001, theta: -5, vega: 2,
      }),
      leg({
        type: 'put', direction: 'sell', strike: 65_000, entryPrice: 100,
        delta: -0.3, gamma: 0.002, theta: -8, vega: 3,
      }),
      leg({
        type: 'call', direction: 'sell', strike: 75_000, entryPrice: 100,
        delta: 0.3, gamma: 0.002, theta: -8, vega: 3,
      }),
      leg({
        type: 'call', direction: 'buy', strike: 80_000, entryPrice: 50,
        delta: null, gamma: 0.001, theta: -5, vega: 2,
      }),
    ];
    const m = computeMetrics(legs, 70_000);
    expect(m.greeksMissingLegs).toBe(1);
    expect(m.netDelta).not.toBeNull();
  });

  it('reports greeksMissingLegs=legs.length when every leg lacks greeks', () => {
    const legs: Leg[] = [
      leg({ type: 'call', direction: 'buy', strike: 70_000, entryPrice: 100 }),
      leg({ type: 'call', direction: 'sell', strike: 72_000, entryPrice: 50 }),
    ];
    const m = computeMetrics(legs, 70_000);
    expect(m.greeksMissingLegs).toBe(2);
    expect(m.netDelta).toBeNull();
  });

  it('takes the worst-case missing count across the four greeks', () => {
    // Leg A is missing only theta. Leg B is missing only vega.
    // Per-greek missing: delta=0, gamma=0, theta=1, vega=1 → worst-case = 1.
    const legs: Leg[] = [
      leg({
        type: 'call', direction: 'buy', strike: 70_000, entryPrice: 100,
        delta: 0.5, gamma: 0.001, theta: null, vega: 5,
      }),
      leg({
        type: 'call', direction: 'sell', strike: 72_000, entryPrice: 50,
        delta: 0.3, gamma: 0.0008, theta: -8, vega: null,
      }),
    ];
    const m = computeMetrics(legs, 70_000);
    expect(m.greeksMissingLegs).toBe(1);
  });
});
