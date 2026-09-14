import { describe, expect, it } from 'vitest';

import type { VegaByStrikeRow } from '@oggregator/protocol';

import { buildStrikeRiskBuckets, translateStrikeRisk } from './strike-risk';

const ROWS: VegaByStrikeRow[] = [
  {
    strike: 85_000,
    expiry: '2026-09-25',
    optionRight: 'call',
    delta: 0.3,
    vega: 110,
    gamma: 0.0001,
    vanna: 0.002,
    volga: 4,
    contracts: 1,
  },
  {
    strike: 85_000,
    expiry: '2026-09-25',
    optionRight: 'put',
    delta: -0.2,
    vega: -30,
    gamma: -0.00004,
    vanna: -0.001,
    volga: -1,
    contracts: 2,
  },
];

describe('translateStrikeRisk', () => {
  it('turns delta into P&L for a one-percent spot rise', () => {
    expect(translateStrikeRisk('delta', 0.00309, 85_000)).toBeCloseTo(2.6265, 8);
  });

  it('keeps vega in dollars per one vol point', () => {
    expect(translateStrikeRisk('vega', 125, 85_000)).toBe(125);
  });

  it('turns gamma into curvature P&L for a five-percent spot move', () => {
    expect(translateStrikeRisk('gamma', 0.0001, 80_000)).toBe(800);
  });

  it('turns vanna and volga into five-vol-point shocks', () => {
    expect(translateStrikeRisk('vanna', 0.002, 85_000)).toBe(0.01);
    expect(translateStrikeRisk('volga', 4, 85_000)).toBe(50);
  });
});

describe('buildStrikeRiskBuckets', () => {
  it('nets calls and puts at the same strike while preserving gross contracts', () => {
    const [bucket] = buildStrikeRiskBuckets(ROWS, '2026-09-25', 'delta', 85_000);
    expect(bucket?.strike).toBe(85_000);
    expect(bucket?.rawValue).toBeCloseTo(0.1, 8);
    expect(bucket?.scenarioValue).toBeCloseTo(85, 8);
    expect(bucket?.contracts).toBe(3);
  });
});
