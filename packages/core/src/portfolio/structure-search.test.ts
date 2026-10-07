import { describe, expect, it } from 'vitest';

import type { PositionLeg } from '@oggregator/protocol';

import { price76 } from '../feeds/thalex/bs-solver.js';
import type { OptionRight } from '../types/common.js';
import { expiryInstantMs } from './horizon-valuation.js';
import {
  findUncoveredShorts,
  searchStructures,
  STRUCTURE_SEARCH_MAX_CANDIDATES,
  type StructureSearchContract,
  type StructureSearchInput,
} from './structure-search.js';
import type { MarkContext } from './types.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const SPOT = 84_000;
const IV = 0.5;
const EXPIRIES = ['2026-10-16', '2026-10-23', '2026-10-30'];

function heldLeg(
  legId: string,
  expiry: string,
  strike: number,
  size: number,
  entryPriceUsd: number,
  optionRight: OptionRight = 'call',
): { leg: PositionLeg; mark: MarkContext } {
  return {
    leg: {
      legId,
      underlying: 'BTC',
      expiry,
      strike,
      optionRight,
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
      markPriceUsd: null,
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

interface ChainOptions {
  expiries?: string[];
  strikeStep?: number;
  halfSpread?: number;
  fee?: number | null;
  overrides?: (contract: StructureSearchContract) => StructureSearchContract;
}

// Black-76 fair values at one IV, quoted ± a fixed fraction, so every number is reproducible.
function chain(options: ChainOptions = {}): StructureSearchContract[] {
  const contracts: StructureSearchContract[] = [];
  const step = options.strikeStep ?? 1_000;
  const halfSpread = options.halfSpread ?? 0.02;
  for (const expiry of options.expiries ?? EXPIRIES) {
    const years = (expiryInstantMs(expiry) - NOW) / (365 * 86_400_000);
    for (let strike = 66_000; strike <= 102_000; strike += step) {
      for (const right of ['call', 'put'] as const) {
        const fair = price76(SPOT, strike, IV, years, right);
        if (fair < 5) continue;
        const quote = {
          bidUsd: Math.round(fair * (1 - halfSpread) * 100) / 100,
          askUsd: Math.round(fair * (1 + halfSpread) * 100) / 100,
          midUsd: Math.round(fair * 100) / 100,
          iv: IV,
          underlyingPriceUsd: SPOT,
          forwardPriceUsd: SPOT,
          feePerContractUsd: options.fee === undefined ? 10 : options.fee,
        };
        const contract: StructureSearchContract = {
          expiry,
          strike,
          right,
          buy: { quote, venue: 'deribit', sizeAtBest: 5 },
          sell: { quote, venue: 'deribit', sizeAtBest: 5 },
        };
        contracts.push(options.overrides ? options.overrides(contract) : contract);
      }
    }
  }
  return contracts;
}

function search(overrides: Partial<StructureSearchInput> = {}) {
  return searchStructures({
    underlying: 'BTC',
    view: 'bearish',
    contracts: chain(),
    held: [],
    spotUsd: SPOT,
    nowMs: NOW,
    maxTotalRiskUsd: 2_000,
    minDte: 1,
    maxDte: 45,
    maxSpreadPct: 25,
    limit: 5,
    ...overrides,
  });
}

describe('findUncoveredShorts', () => {
  it('names the Oct 30 short call once the Oct 16 long expires', () => {
    expect(findUncoveredShorts(REFERENCE_BOOK, NOW)).toEqual([
      {
        legId: 'short-oct30',
        expiry: '2026-10-30',
        strike: 85_000,
        optionRight: 'call',
        size: 1,
        exposure: 'upside_unbounded',
      },
    ]);
  });

  it('treats a vertical as covered and a naked put as downside exposure', () => {
    const book = [
      heldLeg('long', '2026-10-30', 85_000, 1, 3_000),
      heldLeg('short', '2026-10-30', 90_000, -1, 1_000),
      heldLeg('short-put', '2026-10-23', 80_000, -2, 900, 'put'),
    ];
    expect(findUncoveredShorts(book, NOW)).toEqual([
      expect.objectContaining({ legId: 'short-put', size: 2, exposure: 'downside' }),
    ]);
  });
});

describe('searchStructures', () => {
  it('keeps bearish candidates inside the budget and ranks them by reward per unit of risk', () => {
    const result = search({ maxTotalRiskUsd: 1_500, limit: 8 });

    expect(result.status).toBe('ok');
    expect(result.candidates).toHaveLength(8);
    expect(result.nearestInfeasible).toEqual([]);
    expect(result.stats.evaluated).toBeGreaterThan(result.stats.fitting);
    for (const candidate of result.candidates) {
      expect(['long_put', 'put_debit_vertical']).toContain(candidate.family);
      expect(candidate.fits).toBe(true);
      expect(candidate.worstLossUsd).not.toBeNull();
      expect(candidate.worstLossUsd as number).toBeGreaterThanOrEqual(-1_500);
      expect(candidate.headroomUsd).toBeCloseTo(1_500 + (candidate.worstLossUsd as number), 6);
      expect(candidate.target.spotMovePct).toBe(-10);
      expect(candidate.target.horizonDays).toBeCloseTo(
        (expiryInstantMs(candidate.legs[0]?.expiry ?? '') - NOW) / 86_400_000,
        6,
      );
      // No held book: the book is the candidate, and a debit structure loses its full cost.
      expect(candidate.target.bookPnlUsd).toBeCloseTo(candidate.target.candidatePnlUsd, 6);
      expect(candidate.worstLossUsd as number).toBeCloseTo(-candidate.netCostUsd, 6);
      expect(candidate.score).toBeCloseTo(candidate.target.candidatePnlUsd / candidate.netCostUsd, 6);
    }
    const scores = result.candidates.map((candidate) => candidate.score);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));
  });

  it('prices a put debit spread at ask/bid and reports its breakeven and liquidity', () => {
    const result = search({ maxTotalRiskUsd: 100_000, limit: 8 });
    const vertical = result.candidates.find((candidate) => candidate.family === 'put_debit_vertical');
    expect(vertical).toBeDefined();
    const [long, short] = vertical?.legs ?? [];
    expect(long).toMatchObject({ side: 'buy', optionRight: 'put', role: 'trade', feeSource: 'quote', feeUsd: 10 });
    expect(short).toMatchObject({ side: 'sell', optionRight: 'put', expiry: long?.expiry });
    expect((long?.strike ?? 0) - (short?.strike ?? 0)).toBeLessThanOrEqual(0.15 * SPOT);
    const debit = (long?.executablePriceUsd ?? 0) - (short?.executablePriceUsd ?? 0) + 20;
    expect(vertical?.netCostUsd).toBeCloseTo(debit, 6);
    expect(vertical?.breakevens.spotsUsd).toHaveLength(1);
    expect(vertical?.breakevens.spotsUsd[0]).toBeCloseTo((long?.strike ?? 0) - debit, 0);
    expect(vertical?.liquidity).toEqual({
      maxSpreadPct: expect.closeTo(4, 1),
      minSizeAtBest: 5,
      displayedSizeCovers: true,
    });
  });

  it('returns the nearest infeasible candidates with the budget shortfall when nothing fits', () => {
    const result = search({ maxTotalRiskUsd: 5 });

    expect(result.candidates).toEqual([]);
    expect(result.nearestInfeasible).toHaveLength(3);
    for (const candidate of result.nearestInfeasible) {
      expect(candidate.fits).toBe(false);
      expect(candidate.shortfallUsd).toBeCloseTo(-(candidate.worstLossUsd as number) - 5, 6);
    }
    const gaps = result.nearestInfeasible.map((candidate) => candidate.shortfallUsd as number);
    expect(gaps).toEqual([...gaps].sort((left, right) => left - right));
  });

  it('drops contracts wider than maxSpreadPct and estimates a fee when the venue gives none', () => {
    const wide = search({
      contracts: chain({ halfSpread: 0.2, fee: null }),
      maxSpreadPct: 50,
      maxTotalRiskUsd: 100_000,
    });
    expect(wide.stats.illiquidSides).toBe(0);
    expect(wide.candidates[0]?.legs[0]?.feeSource).toBe('default_estimate');
    expect(wide.candidates[0]?.legs[0]?.feeUsd).toBeGreaterThan(0);

    const strict = search({ contracts: chain({ halfSpread: 0.2 }), maxSpreadPct: 25 });
    expect(strict.stats.illiquidSides).toBeGreaterThan(0);
    expect(strict.candidates).toEqual([]);
    expect(strict.stats.enumerated).toBe(0);
  });

  it('evaluates long-vol structures at both signs of the move and ranks on the weaker side', () => {
    const result = search({ view: 'long_vol', maxTotalRiskUsd: 100_000, limit: 8 });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(['long_straddle', 'long_strangle']).toContain(candidate.family);
      expect(candidate.legs.map((leg) => leg.optionRight).sort()).toEqual(['call', 'put']);
      expect(Math.abs(candidate.target.spotMovePct)).toBe(10);
    }
  });

  it('finds the Oct 30 higher-strike cover and the buy-back for the reference book', () => {
    const result = search({ view: 'hedge_held_shorts', held: REFERENCE_BOOK, maxTotalRiskUsd: 5_000, limit: 8 });

    expect(result.status).toBe('ok');
    expect(result.heldBook).toMatchObject({ upsideUnbounded: true, unboundedAfter: '2026-10-16', legCount: 2 });
    const covers = result.candidates.filter((candidate) => candidate.family === 'cover_short');
    expect(covers.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.coveredShortLegIds).toEqual(['short-oct30']);
      expect(candidate.worstLossUsd).not.toBeNull();
      const [leg] = candidate.legs;
      expect(leg).toMatchObject({ role: 'cover', side: 'buy', size: 1, expiry: '2026-10-30', optionRight: 'call' });
      expect(leg?.strike).toBeGreaterThanOrEqual(85_000);
      expect(candidate.target.spotMovePct).toBe(10);
    }
    expect(covers.every((candidate) => (candidate.legs[0]?.strike ?? 0) > 85_000)).toBe(true);
    expect(result.candidates.some((candidate) => candidate.family === 'buy_back_short')).toBe(true);

    // Book-wide worst loss with a 90k cover, as in the evaluator: at Oct 16 the 85/90 spread keeps
    // 14 days of time value; at Oct 30 the low is at 87k, where the expired long is worthless.
    const cover90 = result.candidates.find((candidate) => candidate.label.endsWith('with 90000 call'));
    const ask = cover90?.legs[0]?.executablePriceUsd ?? 0;
    const windowOne =
      -1_050 + 3_031.95 - price76(87_000, 85_000, IV, 14 / 365, 'call') + price76(87_000, 90_000, IV, 14 / 365, 'call') - ask;
    const windowTwo = -2_000 - 1_050 + 3_031.95 - ask;
    expect(cover90?.worstLossUsd).toBeCloseTo(Math.min(windowOne, windowTwo) - 10, 2);
  });

  it('requires a held book for the hedge view', () => {
    expect(search({ view: 'hedge_held_shorts' }).status).toBe('no_held_book');
    const covered = [heldLeg('long', '2026-10-30', 85_000, 1, 3_000), heldLeg('short', '2026-10-30', 90_000, -1, 1_000)];
    expect(search({ view: 'hedge_held_shorts', held: covered }).status).toBe('no_uncovered_shorts');
  });

  it('pairs a bearish trade with the cheapest cover when the reference book is unbounded', () => {
    const result = search({ held: REFERENCE_BOOK, maxTotalRiskUsd: 18 });

    expect(result.cover?.label).toBe('Buy back 2026-10-30 85000 call');
    // Bare puts cannot bound the naked call, so only two-part candidates are evaluated.
    expect(result.stats.skippedUnbounded).toBeGreaterThan(0);
    expect(result.stats.evaluated).toBe(
      Math.min(STRUCTURE_SEARCH_MAX_CANDIDATES, result.stats.enumerated - result.stats.skippedUnbounded),
    );
    expect(result.cover?.bookWorstLossUsd).toBeLessThan(-18);
    expect(result.candidates).toEqual([]);
    expect(result.nearestInfeasible.length).toBeGreaterThan(0);
    for (const candidate of result.nearestInfeasible) {
      expect(candidate.label.startsWith('Buy back 2026-10-30 85000 call + ')).toBe(true);
      expect(candidate.legs[0]).toMatchObject({ role: 'cover', strike: 85_000, side: 'buy' });
      expect(candidate.legs.slice(1).every((leg) => leg.role === 'trade' && leg.optionRight === 'put')).toBe(true);
      expect(candidate.shortfallUsd).toBeCloseTo(-(candidate.worstLossUsd as number) - 18, 6);
    }

    const roomy = search({ held: REFERENCE_BOOK, maxTotalRiskUsd: 3_000 });
    expect(roomy.candidates.length).toBeGreaterThan(0);
    expect(roomy.candidates.every((candidate) => candidate.coveredShortLegIds.includes('short-oct30'))).toBe(true);
    expect(roomy.candidates.every((candidate) => (candidate.worstLossUsd as number) >= -3_000)).toBe(true);
  });

  it('evaluates at most the cap, nearest the money first', () => {
    const expiries = ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30', '2026-11-27', '2026-12-25'];
    const result = search({ contracts: chain({ expiries, strikeStep: 250 }), maxTotalRiskUsd: 100_000 });

    expect(result.stats.enumerated).toBeGreaterThan(STRUCTURE_SEARCH_MAX_CANDIDATES);
    expect(result.stats.evaluated + result.stats.failedEvaluations).toBe(STRUCTURE_SEARCH_MAX_CANDIDATES);
    expect(result.notes.some((note) => note.includes('nearest the money were evaluated'))).toBe(true);
    for (const candidate of result.candidates) {
      for (const leg of candidate.legs) expect(Math.abs(leg.strike / SPOT - 1)).toBeLessThanOrEqual(0.2);
    }
  });
});
