import type {
  BreakEvenIvRow,
  PortfolioPnlCurve,
  PortfolioTotals,
  PositionLeg,
  ShockGridCell,
} from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { calculateIvEdge, classifyBook, getParallelVolShock, getSpotShock } from './risk-profile';

const TOTALS: PortfolioTotals = {
  netDeltaUsd: 0,
  netGammaUsd: 0,
  netVegaUsd: 0,
  netThetaUsd: 0,
  netVannaUsd: 0,
  netVolgaUsd: 0,
  unrealizedPnlUsd: 0,
};

function position(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    legId: 'leg-1',
    underlying: 'BTC',
    expiry: '2026-12-25',
    strike: 100_000,
    optionRight: 'call',
    size: 1,
    entryPriceUsd: 1_000,
    entryIv: 0.6,
    realizedPnlUsd: 0,
    entryTs: 0,
    venueHint: null,
    source: 'manual',
    ...overrides,
  };
}

function breakEven(overrides: Partial<BreakEvenIvRow> = {}): BreakEvenIvRow {
  return {
    legId: 'leg-1',
    strike: 100_000,
    expiry: '2026-12-25',
    optionRight: 'call',
    entryIv: 0.6,
    currentMarkUsd: 1_100,
    currentIv: 0.65,
    breakEvenIv: 0.61,
    ivCushionPct: 0.04,
    ...overrides,
  };
}

describe('classifyBook', () => {
  it('classifies negative vega as short vol', () => {
    expect(classifyBook({ ...TOTALS, netVegaUsd: -120 }, 2)).toBe('short_vol');
  });

  it('classifies positive vega as long vol', () => {
    expect(classifyBook({ ...TOTALS, netVegaUsd: 120 }, 2)).toBe('long_vol');
  });

  it('keeps an empty portfolio flat', () => {
    expect(classifyBook({ ...TOTALS, netVegaUsd: 120 }, 0)).toBe('flat');
  });
});

describe('calculateIvEdge', () => {
  it('treats rising IV as favorable for a long option', () => {
    const result = calculateIvEdge([position()], [breakEven()]);

    expect(result?.edgeVolPts).toBeCloseTo(5);
  });

  it('treats falling IV as favorable for a short option', () => {
    const result = calculateIvEdge(
      [position({ size: -2 })],
      [breakEven({ currentIv: 0.5 })],
    );

    expect(result?.edgeVolPts).toBeCloseTo(10);
  });

  it('returns null when live IV is unavailable', () => {
    expect(calculateIvEdge([position()], [breakEven({ currentIv: null })])).toBeNull();
  });
});

describe('scenario translations', () => {
  it('selects the zero-skew cell for a parallel vol shock', () => {
    const grid: ShockGridCell[][] = [[
      { atmShiftVolPts: 5, skewShiftPerLogK: -0.1, totalPnlUsd: 20 },
      { atmShiftVolPts: 5, skewShiftPerLogK: 0, totalPnlUsd: 50 },
    ]];

    expect(getParallelVolShock(grid, 5)).toBe(50);
  });

  it('returns incremental P&L at the nearest spot shock point', () => {
    const curve: PortfolioPnlCurve = {
      status: 'ok',
      underlying: 'BTC',
      currentSpotUsd: 100,
      breakEvenPricesUsd: [],
      maxProfitUsd: null,
      maxLossUsd: null,
      upsideBounded: false,
      downsideBounded: false,
      points: [
        { underlyingPriceUsd: 95, nowPnlUsd: -40, forwardPnlUsd: null, expiryPnlUsd: -100 },
        { underlyingPriceUsd: 100, nowPnlUsd: 10, forwardPnlUsd: null, expiryPnlUsd: -50 },
        { underlyingPriceUsd: 105, nowPnlUsd: 90, forwardPnlUsd: null, expiryPnlUsd: 0 },
      ],
    };

    expect(getSpotShock(curve, 0.05)).toBe(80);
  });
});
