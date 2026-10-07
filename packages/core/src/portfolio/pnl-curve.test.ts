import { describe, expect, it } from 'vitest';

import type { PositionLeg } from '@oggregator/protocol';

import { buildPortfolioPnlCurve } from './pnl-curve.js';
import type { MarkContext } from './types.js';

const NOW = Date.UTC(2026, 4, 12);
const SIGMA = 0.6;

function makeLeg(partial: Partial<PositionLeg> & { strike: number; size: number }): PositionLeg {
  return {
    legId: `leg-${partial.strike}-${partial.size}`,
    underlying: 'BTC',
    expiry: '2026-08-12',
    optionRight: 'call',
    entryPriceUsd: 1_000,
    entryIv: SIGMA,
    entryTs: NOW,
    venueHint: null,
    source: 'manual',
    realizedPnlUsd: 0,
    ...partial,
  };
}

function makeMark(): MarkContext {
  return {
    underlyingPriceUsd: 70_000,
    forwardPriceUsd: 70_000,
    markPriceUsd: 4_000,
    iv: SIGMA,
    delta: 0.5,
    gamma: 0.0001,
    vega: 100,
    theta: -50,
    yearsToExpiry: 0.25,
  };
}

describe('buildPortfolioPnlCurve', () => {
  it('computes expiry break-even prices for a single-underlying book', () => {
    const curve = buildPortfolioPnlCurve(
      [{ leg: makeLeg({ strike: 70_000, size: 1 }), mark: makeMark() }],
      NOW,
      7,
    );

    expect(curve.status).toBe('ok');
    expect(curve.points.length).toBeGreaterThan(20);
    expect(curve.breakEvenPricesUsd).toHaveLength(1);
    expect(Math.abs((curve.breakEvenPricesUsd[0] ?? 0) - 71_000)).toBeLessThan(150);
  });

  it('returns mixed_underlyings when the book spans multiple assets', () => {
    const curve = buildPortfolioPnlCurve(
      [
        { leg: makeLeg({ strike: 70_000, size: 1, underlying: 'BTC' }), mark: makeMark() },
        { leg: makeLeg({ strike: 3_000, size: 1, underlying: 'ETH', legId: 'eth-leg' }), mark: makeMark() },
      ],
      NOW,
      0,
    );

    expect(curve.status).toBe('mixed_underlyings');
    expect(curve.points).toEqual([]);
  });

  it('keeps the same-expiry vertical loss bound and adds a single risk window', () => {
    const curve = buildPortfolioPnlCurve(
      [
        { leg: makeLeg({ strike: 70_000, size: 1, entryPriceUsd: 3_000 }), mark: makeMark() },
        { leg: makeLeg({ strike: 76_000, size: -1, entryPriceUsd: 1_000 }), mark: makeMark() },
      ],
      NOW,
      0,
    );

    expect(curve.expiryBasis).toBe('common_expiry');
    expect(curve.maxLossUsd).toBeCloseTo(-2_000, 6);
    expect(curve.maxLossUsd).toBe(Math.min(...curve.points.map((point) => point.expiryPnlUsd)));
    expect(curve.maxProfitUsd).toBeCloseTo(4_000, 6);
    expect(curve.upsideBounded).toBe(true);
    expect(curve.downsideBounded).toBe(true);
    expect(curve.riskWindows).toHaveLength(1);
    expect(curve.riskWindows[0]?.worstLossUsd).toBeCloseTo(-2_000, 6);
  });

  it('reports no loss bound once a later short call outlives the long call', () => {
    const curve = buildPortfolioPnlCurve(
      [
        {
          leg: makeLeg({ legId: 'long', expiry: '2026-06-12', strike: 72_000, size: 1, entryPriceUsd: 1_050 }),
          mark: makeMark(),
        },
        {
          leg: makeLeg({ legId: 'short', expiry: '2026-06-26', strike: 70_000, size: -1, entryPriceUsd: 3_031.95 }),
          mark: makeMark(),
        },
      ],
      NOW,
      0,
    );

    expect(curve.status).toBe('ok');
    expect(curve.expiryBasis).toBe('mixed_expiry');
    expect(curve.maxLossUsd).toBeNull();
    expect(curve.upsideBounded).toBe(false);
    expect(curve.riskWindows.map((window) => window.upsideUnbounded)).toEqual([false, true]);
    expect(curve.riskWindows[1]?.liveLegIds).toEqual(['short']);
    // The plotted expiry series still settles both legs at one common spot.
    expect(Math.min(...curve.points.map((point) => point.expiryPnlUsd))).toBeCloseTo(-18.05, 6);
  });

  it('takes the worst window loss for a covered mixed-expiry book', () => {
    const curve = buildPortfolioPnlCurve(
      [
        {
          leg: makeLeg({ legId: 'short', expiry: '2026-06-12', strike: 70_000, size: -1, entryPriceUsd: 2_000 }),
          mark: makeMark(),
        },
        {
          leg: makeLeg({ legId: 'long', expiry: '2026-06-26', strike: 70_000, size: 1, entryPriceUsd: 3_000 }),
          mark: makeMark(),
        },
      ],
      NOW,
      0,
    );

    expect(curve.expiryBasis).toBe('mixed_expiry');
    expect(curve.maxLossUsd).toBeCloseTo(-1_000, 4);
    expect(curve.maxLossUsd).toBe(Math.min(...curve.riskWindows.map((window) => window.worstLossUsd ?? 0)));
  });
});
