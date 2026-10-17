import { describe, expect, it } from 'vitest';

import { marginCallPnl, marginCallPrices, nowPnlAt } from './margin-call';

const points = [
  { underlyingPriceUsd: 60_000, nowPnlUsd: -1_000, forwardPnlUsd: null, expiryPnlUsd: -1_000 },
  { underlyingPriceUsd: 80_000, nowPnlUsd: 0, forwardPnlUsd: null, expiryPnlUsd: 0 },
  { underlyingPriceUsd: 100_000, nowPnlUsd: -1_000, forwardPnlUsd: null, expiryPnlUsd: -1_000 },
];

describe('margin call helpers', () => {
  it('interpolates the now curve and returns null outside the grid', () => {
    expect(nowPnlAt(points, 70_000)).toBe(-500);
    expect(nowPnlAt(points, 50_000)).toBeNull();
  });

  it('places the IM breach level remaining margin below the P&L at spot', () => {
    expect(marginCallPnl(points, 70_000, 200)).toBe(-700);
  });

  it('finds the nearest breach on each side of spot', () => {
    expect(marginCallPrices(points, 80_000, -500)).toEqual({ below: 70_000, above: 90_000 });
  });

  it('reports no breach when the curve never reaches the level', () => {
    expect(marginCallPrices(points, 80_000, -5_000)).toEqual({ below: null, above: null });
  });
});
