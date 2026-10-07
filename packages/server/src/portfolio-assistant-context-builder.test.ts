import {
  InMemoryPositionStore,
  PortfolioRuntime,
  type PositionLeg,
} from '@oggregator/core';
import type { PortfolioPnlCurve, ShockGridCell } from '@oggregator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortfolioRefStore } from './assistant-market/portfolio-ref.js';
import { SyntheticMarket } from './assistant-eval/synthetic-market.js';
import { readPortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';

vi.mock('./portfolio-services.js', () => ({
  bootstrapPortfolioForAccount: vi.fn(async () => undefined),
  getOrCreatePortfolioRuntime: vi.fn(),
}));

const services = await import('./portfolio-services.js');
const {
  assemblePortfolioAssistantContext,
  buildRiskBudgetFacts,
  CONTEXT_COMPACTED_LIMITATION,
  PORTFOLIO_ASSISTANT_TOOL_HINTS,
  PortfolioAssistantContextBuilder,
  toShockFacts,
  trimPayoffFacts,
  trimShockFacts,
} = await import('./portfolio-assistant-context-builder.js');

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const SPOT = 83_886.66;
const ACCOUNT = 'acct-1';

function leg(legId: string, expiry: string, strike: number, size: number, entryPriceUsd: number): PositionLeg {
  return {
    legId,
    underlying: 'BTC',
    expiry,
    strike,
    optionRight: 'call',
    size,
    entryPriceUsd,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: NOW - 86_400_000,
    venueHint: null,
    source: 'manual',
  };
}

function diagonalRuntime(): PortfolioRuntime {
  const market = new SyntheticMarket({
    underlying: 'BTC',
    spotUsd: SPOT,
    nowMs: NOW,
    basisPerYear: 0.03,
    atmFloor: 0.4,
    atmFrontPremium: 0.08,
    skew: -0.15,
    curvature: 0.6,
  });
  const store = new InMemoryPositionStore();
  store.upsert(ACCOUNT, leg('long-oct16-87000-c', '2026-10-16', 87_000, 1, 1_050));
  store.upsert(ACCOUNT, leg('short-oct30-85000-c', '2026-10-30', 85_000, -1, 3_031.95));
  return new PortfolioRuntime({
    accountId: ACCOUNT,
    store,
    markProvider: market.markProvider(),
    now: () => NOW,
    underlyingFilter: 'BTC',
  });
}

function assembleDiagonal(maxContextCharacters: number) {
  const runtime = diagonalRuntime();
  const computation = runtime.computeMetricsAt(0);
  if (computation.error != null) throw new Error(computation.error.message);
  return assemblePortfolioAssistantContext({
    source: 'manual',
    underlying: 'BTC',
    forwardDays: 0,
    nowMs: NOW,
    portfolioRef: 'pref_test',
    computation,
    legsWithMarks: runtime.legsWithMarks(),
    horizonScenarios: runtime.computeHorizonScenarios([0, 7], [-5, 0, 5]),
    marketFacts: { underlyings: [], unavailable: [] },
    tradeHistoryFacts: null,
    limitations: [],
    maxContextCharacters,
  });
}

function linearCurve(forwardDays: number): PortfolioPnlCurve {
  const points = Array.from({ length: 61 }, (_, index) => {
    const underlyingPriceUsd = 70_000 + index * 500.123;
    const expiryPnlUsd = index === 31 ? 9_999.999 : (index - 20) * 100.555;
    return {
      underlyingPriceUsd,
      nowPnlUsd: expiryPnlUsd / 2,
      forwardPnlUsd: forwardDays > 0 ? expiryPnlUsd / 3 : null,
      expiryPnlUsd,
    };
  });
  return {
    status: 'ok',
    underlying: 'BTC',
    currentSpotUsd: 84_000.004,
    breakEvenPricesUsd: [70_000 + 19.5 * 500.123],
    maxProfitUsd: null,
    maxLossUsd: -2_011.1,
    upsideBounded: false,
    downsideBounded: false,
    points,
    expiryBasis: 'common_expiry',
    riskWindows: [],
  };
}

describe('trimPayoffFacts', () => {
  it('keeps every third point plus breakeven neighbours and extrema, rounded and sorted', () => {
    const curve = linearCurve(0);
    const trimmed = trimPayoffFacts(curve, 0);
    const prices = trimmed.points.map((point) => point.underlyingPriceUsd);
    const priceAt = (index: number) => Math.round((curve.points[index]?.underlyingPriceUsd ?? 0) * 100) / 100;

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(new Set(prices).size).toBe(prices.length);
    for (const index of [0, 3, 30, 60]) expect(prices).toContain(priceAt(index));
    expect(prices).toContain(priceAt(19));
    expect(prices).toContain(priceAt(20));
    expect(prices).toContain(priceAt(31));
    expect(trimmed.points.length).toBe(24);
    expect(trimmed.points.find((point) => point.underlyingPriceUsd === priceAt(31))?.expiryPnlUsd).toBe(10_000);
    expect(trimmed.points.every((point) => !('forwardPnlUsd' in point))).toBe(true);
    expect(trimmed.currentSpotUsd).toBe(84_000);
    expect(trimmed.maxLossUsd).toBe(-2_011.1);
  });

  it('keeps forward P&L when a forward horizon is set', () => {
    const trimmed = trimPayoffFacts(linearCurve(3), 3);
    expect(trimmed.points.every((point) => typeof point.forwardPnlUsd === 'number')).toBe(true);
  });
});

describe('buildRiskBudgetFacts', () => {
  const window = {
    from: '2026-10-07T12:00:00.000Z',
    until: '2026-10-16',
    liveLegIds: ['a', 'b'],
    netCallSize: 0,
    upsideUnbounded: false,
    lossAtZeroSpotUsd: 10.004,
    worstLossUsd: -18.054,
    worstLossSpotUsd: 87_000,
  };

  it('reports the lowest windowed loss when every window is bounded', () => {
    const facts = buildRiskBudgetFacts(
      { status: 'ok', riskWindows: [window, { ...window, until: '2026-10-30', worstLossUsd: -5 }] },
      [],
    );
    expect(facts.worstLossUsd).toBe(-18.05);
    expect(facts.unboundedAfter).toBeNull();
    expect(facts.note).toContain('2026-10-16');
  });

  it('flags unbounded windows and lists uncovered shorts', () => {
    const facts = buildRiskBudgetFacts(
      {
        status: 'ok',
        riskWindows: [
          window,
          { ...window, from: '2026-10-16', until: '2026-10-30', upsideUnbounded: true, worstLossUsd: null },
        ],
      },
      [
        {
          legId: 'short',
          expiry: '2026-10-30',
          strike: 85_000,
          optionRight: 'call',
          size: 1,
          exposure: 'upside_unbounded',
        },
      ],
    );
    expect(facts.worstLossUsd).toBeNull();
    expect(facts.unboundedAfter).toBe('2026-10-16');
    expect(facts.uncoveredShorts).toEqual([
      { legId: 'short', expiry: '2026-10-30', strike: 85_000, right: 'call', size: 1 },
    ]);
  });

  it('says unknown, not unbounded, when windows are unavailable', () => {
    const facts = buildRiskBudgetFacts({ status: 'missing_marks', riskWindows: [] }, null);
    expect(facts.worstLossUsd).toBeNull();
    expect(facts.unboundedAfter).toBeNull();
    expect(facts.note).toContain('unknown');
  });
});

describe('shock facts', () => {
  const atm = [-20, -10, -5, 0, 5, 10, 20];
  const skew = [-0.5, -0.25, 0, 0.25, 0.5];
  const grid: ShockGridCell[][] = atm.map((atmShiftVolPts) =>
    skew.map((skewShiftPerLogK) => ({
      atmShiftVolPts,
      skewShiftPerLogK,
      totalPnlUsd: atmShiftVolPts * 10.123 + skewShiftPerLogK,
    })),
  );
  const meta = { totalLegs: 1, pricedLegs: 1, excludedLegIds: [], anchor: 'per_leg_forward' as const };

  it('reshapes the grid into axis arrays and a rounded matrix', () => {
    const facts = toShockFacts(grid, meta);
    expect(facts?.rowsAtmShiftVolPts).toEqual(atm);
    expect(facts?.columnsSkewShiftPerLogK).toEqual(skew);
    expect(facts?.totalPnlUsd[0]?.[0]).toBe(-202.96);
    expect(toShockFacts([], meta)).toBeNull();
  });

  it('trims rows beyond ±10 vol points and columns beyond ±0.25 skew', () => {
    const facts = toShockFacts(grid, meta);
    if (facts == null) throw new Error('expected shock facts');
    const trimmed = trimShockFacts(facts);
    expect(trimmed.rowsAtmShiftVolPts).toEqual([-10, -5, 0, 5, 10]);
    expect(trimmed.columnsSkewShiftPerLogK).toEqual([-0.25, 0, 0.25]);
    expect(trimmed.totalPnlUsd).toHaveLength(5);
    expect(trimmed.totalPnlUsd[0]).toEqual([-101.48, -101.23, -100.98]);
  });
});

describe('assemblePortfolioAssistantContext', () => {
  it('derives riskBudgetFacts from the engine for an uncovered diagonal', () => {
    const context = assembleDiagonal(160_000);
    expect(context.riskBudgetFacts.worstLossUsd).toBeNull();
    expect(context.riskBudgetFacts.unboundedAfter).toBe('2026-10-16');
    expect(context.riskBudgetFacts.uncoveredShorts).toEqual([
      { legId: 'short-oct30-85000-c', expiry: '2026-10-30', strike: 85_000, right: 'call', size: 1 },
    ]);
    expect(context.riskBudgetFacts.riskWindows).toEqual(context.payoffFacts.riskWindows);
    expect(context.payoffFacts.maxLossUsd).toBeNull();
    expect(context.shockFacts?.rowsAtmShiftVolPts).toHaveLength(9);
    expect(context.limitations).not.toContain(CONTEXT_COMPACTED_LIMITATION);
  });

  it('keeps riskBudgetFacts and toolHints through shock trimming and compaction', () => {
    const full = assembleDiagonal(160_000);
    const compacted = assembleDiagonal(1_000);
    expect(compacted.limitations).toContain(CONTEXT_COMPACTED_LIMITATION);
    expect(compacted.limitations.some((item) => item.startsWith('shockFacts keeps'))).toBe(true);
    expect(compacted.shockFacts?.columnsSkewShiftPerLogK.every((value) => Math.abs(value) <= 0.25)).toBe(true);
    expect(compacted.riskBudgetFacts).toEqual(full.riskBudgetFacts);
    expect(compacted.toolHints).toEqual(full.toolHints);
  });

  it('names the tools that accept portfolioRef', () => {
    const hints = PORTFOLIO_ASSISTANT_TOOL_HINTS.join('\n');
    expect(hints).toContain('oggregator_evaluate_structure');
    expect(hints).toContain('oggregator_structure_search');
    expect(hints).toContain('portfolioRef');
  });
});

describe('PortfolioAssistantContextBuilder', () => {
  beforeEach(() => {
    vi.mocked(services.getOrCreatePortfolioRuntime).mockReturnValue(diagonalRuntime());
  });

  it('mints a resolvable portfolioRef and attaches riskBudgetFacts', async () => {
    const refs = new PortfolioRefStore({ now: () => NOW });
    const builder = new PortfolioAssistantContextBuilder(
      readPortfolioAssistantConfiguration({}),
      null,
      null,
      () => NOW,
      refs,
    );
    const context = await builder.buildPortfolioAssistantContext({
      accountId: ACCOUNT,
      source: 'manual',
      underlying: 'BTC',
      forwardDays: 0,
    });
    const resolved = refs.resolve(context.portfolioRef);
    expect(resolved.ok && resolved.scope.accountId).toBe(ACCOUNT);
    expect(context.toolHints).toEqual([...PORTFOLIO_ASSISTANT_TOOL_HINTS]);
    expect(context.riskBudgetFacts.uncoveredShorts.map((short) => short.legId)).toEqual([
      'short-oct30-85000-c',
    ]);
  });
});
