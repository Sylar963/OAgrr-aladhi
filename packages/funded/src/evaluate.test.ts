import { describe, expect, it } from 'vitest';
import {
  accrueRevShare,
  computeSettlement,
  evaluateFundedFloor,
  evaluateTestRoute,
} from './evaluate.js';

describe('evaluateTestRoute', () => {
  it('passes at exactly +10%', () => {
    expect(evaluateTestRoute(1100, 1000, 0.1, 0.3).result).toBe('pass');
  });
  it('passes above +10%', () => {
    expect(evaluateTestRoute(1101, 1000, 0.1, 0.3).result).toBe('pass');
  });
  it('fails at exactly -30%', () => {
    expect(evaluateTestRoute(700, 1000, 0.1, 0.3).result).toBe('fail');
  });
  it('fails below -30%', () => {
    expect(evaluateTestRoute(699, 1000, 0.1, 0.3).result).toBe('fail');
  });
  it('continues between thresholds', () => {
    expect(evaluateTestRoute(1050, 1000, 0.1, 0.3).result).toBe('continue');
    expect(evaluateTestRoute(800, 1000, 0.1, 0.3).result).toBe('continue');
  });
});

describe('evaluateFundedFloor', () => {
  it('breaches below 80% of ABC', () => {
    expect(evaluateFundedFloor(799, 1000, 0.8)).toBe(true);
  });
  it('does not breach at exactly 80%', () => {
    expect(evaluateFundedFloor(800, 1000, 0.8)).toBe(false);
  });
  it('does not breach above floor', () => {
    expect(evaluateFundedFloor(1200, 1000, 0.8)).toBe(false);
  });
});

describe('accrueRevShare', () => {
  it('is 80% of positive cumulative profit', () => {
    expect(accrueRevShare(1500, 1000, 0.8)).toBeCloseTo(400, 8);
  });
  it('is zero when at or below ABC credited', () => {
    expect(accrueRevShare(1000, 1000, 0.8)).toBe(0);
    expect(accrueRevShare(900, 1000, 0.8)).toBe(0);
  });
});

describe('computeSettlement', () => {
  it('computes profit, share, drawdown and floor flag together', () => {
    const c = computeSettlement(900, 1000, 0.8, 0.8);
    expect(c.cumulativeProfitUsd).toBeCloseTo(-100, 8);
    expect(c.traderShareUsd).toBe(0);
    expect(c.drawdownPct).toBeCloseTo(0.1, 8);
    expect(c.floorBreached).toBe(false);
  });
  it('flags breach and reports drawdown when equity dips below floor', () => {
    const c = computeSettlement(750, 1000, 0.8, 0.8);
    expect(c.drawdownPct).toBeCloseTo(0.25, 8);
    expect(c.floorBreached).toBe(true);
    expect(c.traderShareUsd).toBe(0);
  });
  it('reports zero drawdown when equity exceeds ABC', () => {
    const c = computeSettlement(1300, 1000, 0.8, 0.8);
    expect(c.drawdownPct).toBe(0);
    expect(c.cumulativeProfitUsd).toBeCloseTo(300, 8);
    expect(c.traderShareUsd).toBeCloseTo(240, 8);
  });
});
