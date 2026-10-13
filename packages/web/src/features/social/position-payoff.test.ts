import type { PublicPositionDto } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { groupPositions, payoffPoints, payoffSummary, strategyName } from './position-payoff';

function leg(
  strike: number,
  optionRight: 'call' | 'put',
  netQuantity: number,
  avgEntryPriceUsd: number,
  expiry = '2026-10-30',
  unrealizedPnlUsd: number | null = 0,
): PublicPositionDto {
  return {
    underlying: 'BTC',
    expiry,
    strike,
    optionRight,
    netQuantity,
    avgEntryPriceUsd,
    markPriceUsd: null,
    unrealizedPnlUsd,
  };
}

const BULL_PUT = [leg(90_000, 'put', -0.01, 7025), leg(87_000, 'put', 0.01, 4870)];

describe('position payoff', () => {
  it('summarizes a put credit spread at expiry', () => {
    const summary = payoffSummary(BULL_PUT);
    expect(summary.maxProfitUsd).toBeCloseTo(21.55);
    expect(summary.maxLossUsd).toBeCloseTo(-8.45);
    expect(summary.breakevens).toHaveLength(1);
    expect(summary.breakevens[0]).toBeCloseTo(87_845);
    expect(strategyName(BULL_PUT)).toBe('Bull Put Spread');
  });

  it('marks unbounded payoffs as unlimited', () => {
    const shortCall = [leg(100_000, 'call', -0.02, 335)];
    expect(payoffSummary(shortCall)).toMatchObject({
      maxProfitUsd: 6.7,
      maxLossUsd: null,
    });
    expect(payoffSummary(shortCall).breakevens[0]).toBeCloseTo(100_335);
    expect(strategyName(shortCall)).toBe('Short Call');
  });

  it('samples the curve exactly at every strike inside the range', () => {
    const points = payoffPoints(BULL_PUT, 80_000, 95_000);
    expect(points.map((p) => p.price)).toEqual([80_000, 87_000, 90_000, 95_000]);
    expect(points[0]!.pnl).toBeCloseTo(-8.45);
    expect(points.at(-1)!.pnl).toBeCloseTo(21.55);
  });

  it('groups legs by underlying and expiry, nearest first', () => {
    const groups = groupPositions([
      leg(90_000, 'put', -0.01, 8300, '2026-11-27', 5),
      ...BULL_PUT.map((l) => ({ ...l, unrealizedPnlUsd: -2 })),
      leg(85_000, 'put', 0.01, 5250, '2026-11-27', null),
    ]);
    expect(groups.map((g) => [g.expiry, g.legs.length, g.unrealizedPnlUsd])).toEqual([
      ['2026-10-30', 2, -4],
      ['2026-11-27', 2, 5],
    ]);
  });
});
