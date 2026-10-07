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
  firstStrike?: number;
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
    for (let strike = options.firstStrike ?? 66_000; strike <= 102_000; strike += step) {
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

function quoted(expiry: string, strike: number, right: OptionRight) {
  const years = (expiryInstantMs(expiry) - NOW) / (365 * 86_400_000);
  const fair = price76(SPOT, strike, IV, years, right);
  return { bidUsd: Math.round(fair * 0.98 * 100) / 100, askUsd: Math.round(fair * 1.02 * 100) / 100 };
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

// Each search runs hundreds of full book evaluations; leave headroom for a loaded CI runner.
describe('searchStructures', { timeout: 30_000 }, () => {
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
    expect(long).toMatchObject({ side: 'buy', optionRight: 'put', role: 'view', feeSource: 'quote', feeUsd: 10 });
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
      expect(leg).toMatchObject({ role: 'repair', side: 'buy', size: 1, expiry: '2026-10-30', optionRight: 'call' });
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

  it('repairs the unbounded reference book first and pairs the repair with each bearish view', () => {
    const contracts = chain({ expiries: ['2026-10-16', '2026-10-30'], firstStrike: 65_000, strikeStep: 2_000 });
    const result = search({ contracts, held: REFERENCE_BOOK, maxTotalRiskUsd: 3_000 });

    expect(result.rankedBy).toBe('book_reward_to_risk');
    expect(result.repair?.reason).toBe('unbounded');
    expect(result.repair?.considered.map((option) => option.kind).sort()).toEqual(['buy_back', 'close_book', 'cover']);
    const losses = result.repair?.considered.map((option) => option.bookWorstLossUsd as number) ?? [];
    expect(losses).toEqual([...losses].sort((left, right) => right - left));

    // Closing both legs locks entry-relative P&L: sell the Oct 16 87k at bid, buy the Oct 30 85k at ask,
    // 10 USD fee each. It beats the buy-back, which still risks the long's full 1,050 premium.
    const bid87 = quoted('2026-10-16', 87_000, 'call').bidUsd;
    const ask85 = quoted('2026-10-30', 85_000, 'call').askUsd;
    const locked = bid87 - 1_050 + 3_031.95 - ask85 - 20;
    expect(result.repair?.chosen).toMatchObject({
      kind: 'close_book',
      label: 'Close book: sell 2026-10-16 87000 call, buy 2026-10-30 85000 call',
      fits: true,
    });
    expect(result.repair?.chosen.bookWorstLossUsd).toBeCloseTo(locked, 6);
    expect(result.repair?.chosen.legs.every((leg) => leg.role === 'repair')).toBe(true);
    const buyBack = result.repair?.considered.find((option) => option.kind === 'buy_back');
    expect(buyBack?.bookWorstLossUsd).toBeCloseTo(-1_050 + 3_031.95 - ask85 - 10, 6);

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.fits).toBe(true);
      expect(candidate.components[0]).toEqual({ role: 'repair', label: result.repair?.chosen.label });
      expect(candidate.components[1]?.role).toBe('view');
      expect(candidate.legs.filter((leg) => leg.role === 'view').every((leg) => leg.optionRight === 'put')).toBe(true);
      expect(candidate.headroomUsd).toBeCloseTo(3_000 + (candidate.worstLossUsd as number), 6);
    }
    expect(result.repairOnly).toBeNull();

    // Hand check: with both held legs offset, the book-wide low is the locked P&L minus the debit
    // (ask paid, bid received) and fees of the put structure, all at size 1.
    const best = result.candidates[0];
    const debit = (best?.legs ?? [])
      .filter((leg) => leg.role === 'view')
      .reduce((sum, leg) => {
        const quote = quoted(leg.expiry, leg.strike, 'put');
        return sum + (leg.side === 'buy' ? quote.askUsd : -quote.bidUsd) + 10;
      }, 0);
    expect(best?.worstLossUsd).toBeCloseTo(locked - debit, 2);
  });

  it('returns the repair alone and the closest packages with the exact gap when even the repair exceeds $18', () => {
    const contracts = chain({ expiries: ['2026-10-16', '2026-10-30'], firstStrike: 65_000, strikeStep: 2_000 });
    const result = search({ contracts, held: REFERENCE_BOOK, maxTotalRiskUsd: 18, size: 0.1 });

    // Bare puts cannot bound the naked call, so only packages are evaluated.
    expect(result.stats.skippedUnbounded).toBeGreaterThan(0);
    expect(result.stats.evaluated).toBe(result.stats.enumerated - result.stats.skippedUnbounded);
    expect(result.candidates).toEqual([]);
    const repairOnly = result.repairOnly;
    expect(repairOnly?.kind).toBe('close_book');
    expect(repairOnly?.fits).toBe(false);
    expect(repairOnly?.shortfallUsd).toBeCloseTo(-(repairOnly?.bookWorstLossUsd as number) - 18, 6);
    expect(result.nearestInfeasible.length).toBeGreaterThan(0);
    for (const candidate of result.nearestInfeasible) {
      expect(candidate.label.startsWith(`${repairOnly?.label} + `)).toBe(true);
      expect(candidate.components.map((component) => component.role)).toEqual(['repair', 'view']);
      expect(candidate.legs.filter((leg) => leg.role === 'view').every((leg) => leg.size === 0.1)).toBe(true);
      expect(candidate.shortfallUsd).toBeCloseTo(-(candidate.worstLossUsd as number) - 18, 6);
      expect(candidate.shortfallUsd as number).toBeGreaterThan(repairOnly?.shortfallUsd as number);
    }
  });

  it('closes legs of a bounded book that is already over budget before adding the view', () => {
    const bearCall = [heldLeg('short', '2026-10-30', 84_000, -1, 3_000), heldLeg('long', '2026-10-30', 90_000, 1, 1_000)];
    const result = search({ held: bearCall, maxTotalRiskUsd: 1_300 });

    expect(result.heldBook?.worstLossUsd).toBeCloseTo(-4_000, 0);
    expect(result.repair?.reason).toBe('over_budget');
    expect(result.repair?.considered.map((option) => option.kind).sort()).toEqual(['buy_back', 'close_book']);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.components.map((component) => component.role)).toEqual(['repair', 'view']);
      expect(candidate.worstLossUsd as number).toBeGreaterThanOrEqual(-1_300);
    }
  });

  it('offers long-vol packages on an unbounded book', () => {
    const contracts = chain({ expiries: ['2026-10-16', '2026-10-30'], firstStrike: 65_000, strikeStep: 2_000 });
    const result = search({ view: 'long_vol', contracts, held: REFERENCE_BOOK, maxTotalRiskUsd: 3_000, limit: 3 });

    expect(result.repair?.chosen.kind).toBe('close_book');
    expect(result.candidates).toHaveLength(3);
    for (const candidate of result.candidates) {
      expect(['long_straddle', 'long_strangle']).toContain(candidate.family);
      expect(candidate.components[0]?.role).toBe('repair');
    }
  });

  it('stops evaluating at the time budget and says so', () => {
    let now = 0;
    const result = search({ maxTotalRiskUsd: 100_000, clock: () => (now += 1_000) });
    expect(result.stats.stoppedEarly).toBe(true);
    expect(result.stats.evaluated).toBeLessThan(10);
    expect(result.notes.some((note) => note.includes('time budget'))).toBe(true);
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
