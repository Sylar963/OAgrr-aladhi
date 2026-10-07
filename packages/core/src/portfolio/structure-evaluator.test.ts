import { describe, expect, it } from 'vitest';

import type { PositionLeg } from '@oggregator/protocol';

import { price76 } from '../feeds/thalex/bs-solver.js';
import {
  defaultTakerFeeUsd,
  evaluateStructure,
  type ProposedLegQuote,
  type ProposedStructureLeg,
} from './structure-evaluator.js';
import type { MarkContext } from './types.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const SPOT = 84_000;
const IV = 0.5;
const WINDOW_ONE_YEARS = 14 / 365;

function heldLeg(
  legId: string,
  expiry: string,
  strike: number,
  size: number,
  entryPriceUsd: number,
): { leg: PositionLeg; mark: MarkContext } {
  return {
    leg: {
      legId,
      underlying: 'BTC',
      expiry,
      strike,
      optionRight: 'call',
      size,
      entryPriceUsd,
      entryIv: IV,
      entryTs: NOW,
      venueHint: null,
      source: 'manual',
      realizedPnlUsd: 0,
    },
    mark: {
      underlyingPriceUsd: SPOT,
      forwardPriceUsd: SPOT,
      markPriceUsd: 1_000,
      iv: IV,
      delta: null,
      gamma: null,
      vega: null,
      theta: null,
      yearsToExpiry: null,
    },
  };
}

const REFERENCE_BOOK = [
  heldLeg('long-oct16', '2026-10-16', 87_000, 1, 1_050),
  heldLeg('short-oct30', '2026-10-30', 85_000, -1, 3_031.95),
];

function quote(overrides: Partial<ProposedLegQuote> = {}): ProposedLegQuote {
  return {
    bidUsd: 900,
    askUsd: 1_000,
    midUsd: 950,
    iv: IV,
    underlyingPriceUsd: SPOT,
    forwardPriceUsd: SPOT,
    feePerContractUsd: 3,
    ...overrides,
  };
}

function proposed(
  strike: number,
  side: 'buy' | 'sell',
  overrides: Partial<ProposedStructureLeg> = {},
): ProposedStructureLeg {
  return {
    underlying: 'BTC',
    expiry: '2026-10-30',
    strike,
    optionRight: 'call',
    side,
    size: 1,
    venue: 'deribit',
    quote: quote(),
    ...overrides,
  };
}

function evaluate(
  legs: ProposedStructureLeg[],
  held = REFERENCE_BOOK,
  riskBudgetUsd?: number,
) {
  return evaluateStructure({
    held,
    proposed: legs,
    nowMs: NOW,
    horizonsDays: [0, 7],
    spotMovesPct: [-10, 0, 10],
    ...(riskBudgetUsd != null ? { riskBudgetUsd } : {}),
  });
}

describe('evaluateStructure', () => {
  it('caps the reference book upside with a higher-strike Oct 30 call', () => {
    const result = evaluate([proposed(90_000, 'buy')]);

    expect(result.status).toBe('ok');
    expect(result.heldOnly?.upsideUnbounded).toBe(true);
    expect(result.heldOnly?.worstLossUsd).toBeNull();
    expect(result.combined?.upsideUnbounded).toBe(false);
    expect(result.combined?.riskWindows.every((window) => !window.upsideUnbounded)).toBe(true);

    const feeUsd = 3;
    // Oct 16: the 87k long is intrinsic and the Oct 30 85/90 call spread keeps 14 days of
    // time value. P&L falls up to the 87k kink and rises after it (spread delta < 1).
    const windowOneUsd =
      -1_050 +
      3_031.95 -
      price76(87_000, 85_000, IV, WINDOW_ONE_YEARS, 'call') +
      price76(87_000, 90_000, IV, WINDOW_ONE_YEARS, 'call') -
      1_000 -
      feeUsd;
    // Oct 30: everything intrinsic. Net credit after the 90k call and its fee below 85k, minus
    // (S − 85k) up to 87k, flat to 90k, then rising one for one with the net long call.
    const lowSpotUsd = -1_050 + 3_031.95 - 1_000 - feeUsd;
    const windowTwoUsd = lowSpotUsd - 2_000;
    const [first, second] = result.combined?.riskWindows ?? [];
    expect(first?.worstLossSpotUsd).toBe(87_000);
    expect(first?.worstLossUsd).toBeCloseTo(windowOneUsd, 2);
    expect(second?.worstLossUsd).toBeCloseTo(windowTwoUsd, 2);
    expect(second?.lossAtZeroSpotUsd).toBeCloseTo(lowSpotUsd, 6);
    expect(second?.bestProfitUsd).toBeNull();
    expect(second?.breakevenSpotsUsd).toHaveLength(2);
    expect(second?.breakevenSpotsUsd[0]).toBeCloseTo(85_000 + lowSpotUsd, 0);
    expect(second?.breakevenSpotsUsd[1]).toBeCloseTo(90_000 - windowTwoUsd, 0);
    expect(result.combined?.worstLossUsd).toBeCloseTo(Math.min(windowOneUsd, windowTwoUsd), 2);
    expect(result.incrementalBasis).toBe('held_unbounded');
    expect(result.incrementalWorstLossUsd).toBeNull();
  });

  it('removes the unbounded flag when the Oct 30 short is closed', () => {
    const result = evaluate([proposed(85_000, 'buy', { quote: quote({ bidUsd: 3_000, askUsd: 3_100, midUsd: 3_050 }) })]);

    expect(result.combined?.upsideUnbounded).toBe(false);
    expect(result.combined?.unboundedAfter).toBeNull();
    for (const window of result.combined?.riskWindows ?? []) {
      expect(window.netCallSize).toBeGreaterThanOrEqual(0);
    }
    // Long 87k call premium lost plus the 68.05 paid to buy back the short, plus the fee.
    expect(result.combined?.worstLossUsd).toBeCloseTo(-1_050 - (3_100 - 3_031.95) - 3, 2);
    expect(result.heldOnly?.unboundedAfter).toBe('2026-10-16');
  });

  it('enters buys at the ask and sells at the bid, reporting mid and spread separately', () => {
    const result = evaluate(
      [
        proposed(90_000, 'buy'),
        proposed(95_000, 'sell', { quote: quote({ bidUsd: 400, askUsd: 450, midUsd: 425, feePerContractUsd: 2 }) }),
      ],
      [],
    );

    const [buy, sell] = result.legs;
    expect(buy).toMatchObject({ executablePriceUsd: 1_000, midUsd: 950, premiumUsd: 1_000, spreadCostUsd: 50, feeUsd: 3 });
    expect(sell).toMatchObject({ executablePriceUsd: 400, midUsd: 425, premiumUsd: -400, spreadCostUsd: 25, feeUsd: 2 });
    expect(result.totals).toEqual({
      netPremiumUsd: 600,
      midPremiumUsd: 525,
      spreadCostUsd: 75,
      feesUsd: 5,
      netCostUsd: 605,
    });
    // Same-expiry debit call spread: worst loss is the executable debit plus fees.
    expect(result.combined?.worstLossUsd).toBeCloseTo(-605, 6);
    expect(result.heldOnly?.worstLossUsd).toBe(0);
    expect(result.incrementalWorstLossUsd).toBeCloseTo(-605, 6);
  });

  it('estimates a conservative taker fee when a quote carries no venue estimate', () => {
    const run = (overrides: Partial<ProposedLegQuote>) =>
      evaluateStructure({
        held: [],
        proposed: [proposed(90_000, 'buy', { size: 2, quote: quote({ feePerContractUsd: null, ...overrides }) })],
        nowMs: NOW,
        horizonsDays: [0],
        spotMovesPct: [0],
      });

    // 0.05% of 84,000 = 42 per contract, below 12.5% of the 1,000 ask.
    const notional = run({});
    expect(notional.legs[0]).toMatchObject({ feeUsd: 84, feeSource: 'default_estimate' });
    expect(notional.combined?.worstLossUsd).toBeCloseTo(-2_084, 6);

    // A cheap wing is capped at 12.5% of premium: 0.125 × 100 = 12.5 per contract.
    const capped = run({ bidUsd: 90, askUsd: 100, midUsd: 95 });
    expect(capped.legs[0]).toMatchObject({ feeUsd: 25, feeSource: 'default_estimate' });

    // Without any underlying price only the premium cap applies.
    const noSpot = run({ underlyingPriceUsd: null, forwardPriceUsd: null });
    expect(noSpot.legs[0]?.feeUsd).toBeCloseTo(250, 6);
    expect(defaultTakerFeeUsd(1_000, null)).toBe(125);
  });

  it('nets fees out of horizon and expiry payoffs', () => {
    const result = evaluate([proposed(90_000, 'buy')]);

    const oct30 = result.payoffAtExpiries.find((row) => row.expiry === '2026-10-30');
    const flat = oct30?.points.find((point) => point.spotMovePct === 0);
    expect(result.payoffAtExpiries.map((row) => row.expiry)).toEqual(['2026-10-16', '2026-10-30']);
    expect(oct30?.points.map((point) => point.spotMovePct)).toEqual([-20, -15, -10, -5, 0, 5, 10, 15, 20]);
    expect(flat?.spotUsd).toBeCloseTo(SPOT, 6);
    expect(flat?.pnlUsd).toBeCloseTo(-1_050 + 3_031.95 - 1_000 - 3, 2);
    expect(result.horizonScenarios?.cells).toHaveLength(6);
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it('refuses to evaluate when any proposed leg lacks an executable quote', () => {
    const result = evaluate([
      proposed(90_000, 'buy', { quote: quote({ askUsd: null }) }),
      proposed(95_000, 'sell', { quote: null, quoteError: 'No fresh quote for BTC 2026-10-30 95000 call.' }),
    ]);

    expect(result.status).toBe('quote_error');
    expect(result.legs.map((leg) => leg.error)).toEqual([
      'No executable ask.',
      'No fresh quote for BTC 2026-10-30 95000 call.',
    ]);
    expect(result.legs[0]?.executablePriceUsd).toBeNull();
    expect(result.combined).toBeNull();
    expect(result.totals).toBeNull();
    expect(result.budget).toBeNull();
  });

  it('reports whether the combined worst loss fits the risk budget', () => {
    const capped = evaluate([proposed(90_000, 'buy')], REFERENCE_BOOK, 2_000);
    const worst = capped.combined?.worstLossUsd ?? 0;
    expect(capped.budget).toMatchObject({ riskBudgetUsd: 2_000, fits: true });
    expect(capped.budget?.headroomUsd).toBeCloseTo(2_000 + worst, 6);

    const tight = evaluate([proposed(90_000, 'buy')], REFERENCE_BOOK, 18);
    expect(tight.budget?.fits).toBe(false);
    expect(tight.budget?.headroomUsd).toBeLessThan(0);

    const naked = evaluate([proposed(80_000, 'sell')], [], 1_000_000);
    expect(naked.combined?.worstLossUsd).toBeNull();
    expect(naked.budget).toEqual({
      riskBudgetUsd: 1_000_000,
      worstLossUsd: null,
      headroomUsd: null,
      fits: false,
    });
  });

  it('rejects legs on a different underlying', () => {
    const result = evaluate([proposed(3_000, 'buy', { underlying: 'ETH' })]);
    expect(result.status).toBe('mixed_underlyings');
    expect(result.combined).toBeNull();
  });
});
