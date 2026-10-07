import type { PositionLeg } from '@oggregator/protocol';

import type { OptionRight, VenueId } from '../types/common.js';
import { analyzeExpiryStructure, type ExpiryRiskWindow, pnlAtHorizon } from './expiry-structure.js';
import { expiryInstantMs } from './horizon-valuation.js';
import {
  type EvaluatedProposedLeg,
  evaluateStructure,
  type ProposedLegQuote,
  type ProposedStructureLeg,
  proposedLegWithMark,
  type StructureEvaluation,
  STRUCTURE_ASSUMPTIONS,
  summarizeRisk,
} from './structure-evaluator.js';
import type { MarkContext } from './types.js';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

export type StructureSearchView = 'bearish' | 'bullish' | 'long_vol' | 'hedge_held_shorts';

export type StructureSearchFamily =
  | 'long_put'
  | 'put_debit_vertical'
  | 'long_call'
  | 'call_debit_vertical'
  | 'long_straddle'
  | 'long_strangle'
  | 'buy_back_short'
  | 'cover_short'
  | 'cover_all_shorts';

export interface StructureSearchQuoteSide {
  /** Quote of the venue chosen for this side; buys execute at its ask, sells at its bid. */
  quote: ProposedLegQuote;
  venue: VenueId | null;
  sizeAtBest: number | null;
}

export interface StructureSearchContract {
  expiry: string;
  strike: number;
  right: OptionRight;
  buy: StructureSearchQuoteSide | null;
  sell: StructureSearchQuoteSide | null;
}

export interface StructureSearchInput {
  underlying: string;
  view: StructureSearchView;
  contracts: StructureSearchContract[];
  held: LegWithMark[];
  spotUsd: number;
  nowMs: number;
  maxTotalRiskUsd: number;
  minDte: number;
  maxDte: number;
  targetMovePct?: number | null;
  targetHorizonDays?: number | null;
  maxSpreadPct: number;
  limit: number;
  /** Contracts per new trade leg. Covers always match the short they cover. */
  size?: number;
  /** Monotonic milliseconds for the evaluation time budget; defaults to performance.now. */
  clock?: () => number;
}

export interface UncoveredShort {
  legId: string;
  expiry: string;
  strike: number;
  optionRight: OptionRight;
  /** Contracts short, positive. */
  size: number;
  exposure: 'upside_unbounded' | 'downside';
}

export type StructureSearchLegRole = 'view' | 'repair';

export interface StructureSearchComponent {
  role: StructureSearchLegRole;
  label: string;
}

export interface StructureSearchLeg {
  role: StructureSearchLegRole;
  side: 'buy' | 'sell';
  size: number;
  expiry: string;
  strike: number;
  optionRight: OptionRight;
  venue: VenueId | null;
  executablePriceUsd: number | null;
  midUsd: number | null;
  feeUsd: number | null;
  feeSource: EvaluatedProposedLeg['feeSource'];
  spreadPct: number | null;
  sizeAtBest: number | null;
}

export interface StructureSearchCandidate {
  label: string;
  family: StructureSearchFamily;
  /** A package lists its repair first, then the view structure. */
  components: StructureSearchComponent[];
  coveredShortLegIds: string[];
  legs: StructureSearchLeg[];
  netCostUsd: number;
  /** Book-wide when a held book is present; negative is a loss, null is unbounded. */
  worstLossUsd: number | null;
  incrementalWorstLossUsd: number | null;
  headroomUsd: number | null;
  fits: boolean;
  shortfallUsd: number | null;
  target: {
    horizonDays: number;
    spotMovePct: number;
    spotUsd: number;
    bookPnlUsd: number;
    candidatePnlUsd: number;
  };
  /**
   * P&L at the target per dollar of risk: the candidate's own P&L over the worst loss it adds, or,
   * when the held book needs a repair, book P&L over book-wide worst loss.
   */
  score: number;
  breakevens: { expiry: string; spotsUsd: number[] };
  liquidity: { maxSpreadPct: number | null; minSizeAtBest: number | null; displayedSizeCovers: boolean };
}

export type StructureSearchStatus = 'ok' | 'no_held_book' | 'no_uncovered_shorts' | 'missing_marks';

export type StructureSearchRepairKind = 'cover' | 'buy_back' | 'close_book';

/** A repair of the held book evaluated alone against it; book-wide figures. */
export interface StructureSearchRepairOption {
  label: string;
  kind: StructureSearchRepairKind;
  legs: StructureSearchLeg[];
  netCostUsd: number;
  bookWorstLossUsd: number | null;
  headroomUsd: number | null;
  fits: boolean;
  shortfallUsd: number | null;
}

export interface StructureSearchRepair {
  reason: 'unbounded' | 'over_budget';
  /** Highest book-wide worst loss among the bounded options, then the lowest cost. */
  chosen: StructureSearchRepairOption;
  considered: StructureSearchRepairOption[];
}

export type StructureSearchRanking = 'reward_to_risk' | 'book_reward_to_risk';

export interface StructureSearchResult {
  status: StructureSearchStatus;
  view: StructureSearchView;
  maxTotalRiskUsd: number;
  spotUsd: number;
  heldBook: {
    legCount: number;
    worstLossUsd: number | null;
    upsideUnbounded: boolean;
    unboundedAfter: string | null;
    uncoveredShorts: UncoveredShort[];
  } | null;
  /** Set when a directional or long-vol view meets an unbounded or over-budget held book. */
  repair: StructureSearchRepair | null;
  /** The chosen repair alone, when no candidate fits the budget. */
  repairOnly: StructureSearchRepairOption | null;
  rankedBy: StructureSearchRanking;
  candidates: StructureSearchCandidate[];
  nearestInfeasible: StructureSearchCandidate[];
  stats: {
    contracts: number;
    illiquidSides: number;
    enumerated: number;
    skippedUnbounded: number;
    evaluated: number;
    failedEvaluations: number;
    fitting: number;
    repairsEvaluated: number;
    stoppedEarly: boolean;
  };
  notes: string[];
  assumptions: string[];
}

export const STRUCTURE_SEARCH_MAX_CANDIDATES = 600;
export const STRUCTURE_SEARCH_MAX_LIMIT = 8;
export const STRUCTURE_SEARCH_STRIKE_BAND = 0.2;
export const STRUCTURE_SEARCH_MAX_WIDTH = 0.15;
/** Wall-clock cap on candidate evaluation; the MCP client gives a tool call 30 seconds. */
export const STRUCTURE_SEARCH_TIME_BUDGET_MS = 8_000;
const DEFAULT_TARGET_MOVE_PCT = 10;
const DAY_MS = 86_400_000;
const SIZE_EPSILON = 1e-9;
const BREAKEVEN_GRID_STEPS = 400;

interface QuotedLeg {
  role: StructureSearchLegRole;
  side: 'buy' | 'sell';
  size: number;
  contract: StructureSearchContract;
  quoteSide: StructureSearchQuoteSide;
  moneyness: number;
}

interface Draft {
  label: string;
  family: StructureSearchFamily;
  components: StructureSearchComponent[];
  legs: QuotedLeg[];
  coveredShorts: UncoveredShort[];
}

interface RepairDraft extends Draft {
  kind: StructureSearchRepairKind;
}

interface Context {
  input: StructureSearchInput;
  budget: number;
  forwards: Map<string, number>;
  repairMode: boolean;
  heldWindows: ExpiryRiskWindow[] | undefined;
}

function spreadPct(quote: ProposedLegQuote): number | null {
  const { bidUsd, askUsd } = quote;
  if (!(bidUsd != null && askUsd != null && bidUsd > 0 && askUsd >= bidUsd)) return null;
  const mid = quote.midUsd != null && quote.midUsd > 0 ? quote.midUsd : (bidUsd + askUsd) / 2;
  return ((askUsd - bidUsd) / mid) * 100;
}

function usableSide(
  side: StructureSearchQuoteSide | null,
  direction: 'buy' | 'sell',
  maxSpreadPct: number,
): StructureSearchQuoteSide | null {
  if (side == null) return null;
  const price = direction === 'buy' ? side.quote.askUsd : side.quote.bidUsd;
  if (!(price != null && price > 0) || !(side.quote.iv != null && side.quote.iv > 0)) return null;
  const spread = spreadPct(side.quote);
  return spread != null && spread <= maxSpreadPct ? side : null;
}

function daysUntil(expiry: string, nowMs: number): number {
  return (expiryInstantMs(expiry) - nowMs) / DAY_MS;
}

function contractKey(expiry: string, strike: number, right: OptionRight): string {
  return `${expiry}|${strike}|${right}`;
}

/**
 * Short legs that leave a risk window exposed: short calls live in a window whose live
 * calls are net short (upside unbounded), and short puts live in a window whose live puts
 * are net short (loss grows as spot falls). Null when the held book cannot be priced.
 */
export function findUncoveredShorts(held: LegWithMark[], nowMs: number): UncoveredShort[] | null {
  const windows = analyzeExpiryStructure(held, nowMs);
  if (windows == null) return null;
  const byId = new Map(held.map(({ leg }) => [leg.legId, leg]));
  const found = new Map<string, UncoveredShort>();
  for (const window of windows) {
    const live = window.liveLegIds.flatMap((legId) => byId.get(legId) ?? []);
    for (const right of ['call', 'put'] as const) {
      const net = live.reduce((sum, leg) => (leg.optionRight === right ? sum + leg.size : sum), 0);
      if (net >= -SIZE_EPSILON) continue;
      for (const leg of live) {
        if (leg.optionRight !== right || leg.size >= 0 || found.has(leg.legId)) continue;
        found.set(leg.legId, {
          legId: leg.legId,
          expiry: leg.expiry,
          strike: leg.strike,
          optionRight: right,
          size: -leg.size,
          exposure: right === 'call' ? 'upside_unbounded' : 'downside',
        });
      }
    }
  }
  return [...found.values()].sort(
    (left, right) =>
      left.expiry.localeCompare(right.expiry) ||
      left.strike - right.strike ||
      left.optionRight.localeCompare(right.optionRight),
  );
}

function moneyness(ctx: Context, contract: StructureSearchContract): number {
  const forward = ctx.forwards.get(contract.expiry) ?? ctx.input.spotUsd;
  return Math.abs(contract.strike / forward - 1);
}

function quotedLeg(
  ctx: Context,
  role: QuotedLeg['role'],
  contract: StructureSearchContract,
  side: 'buy' | 'sell',
  size: number,
): QuotedLeg {
  return {
    role,
    side,
    size,
    contract,
    quoteSide: contract[side] as StructureSearchQuoteSide,
    moneyness: moneyness(ctx, contract),
  };
}

function viewDraft(label: string, family: StructureSearchFamily, legs: QuotedLeg[]): Draft {
  return { label, family, components: [{ role: 'view', label }], legs, coveredShorts: [] };
}

function tradeDrafts(
  ctx: Context,
  buyable: Map<string, StructureSearchContract[]>,
  sellable: Map<string, StructureSearchContract[]>,
): Draft[] {
  const { input } = ctx;
  const size = input.size ?? 1;
  const maxWidth = STRUCTURE_SEARCH_MAX_WIDTH * input.spotUsd;
  const drafts: Draft[] = [];
  const inWindow = (expiry: string) => {
    const dte = daysUntil(expiry, input.nowMs);
    return dte >= input.minDte && dte <= input.maxDte;
  };
  const expiries = [...new Set(input.contracts.map((contract) => contract.expiry))]
    .filter(inWindow)
    .sort();
  const listed = (map: Map<string, StructureSearchContract[]>, expiry: string, right: OptionRight) =>
    map.get(`${expiry}|${right}`) ?? [];

  for (const expiry of expiries) {
    if (input.view === 'bearish' || input.view === 'bullish') {
      const right: OptionRight = input.view === 'bearish' ? 'put' : 'call';
      const family = right === 'put' ? 'long_put' : 'long_call';
      const vertical = right === 'put' ? 'put_debit_vertical' : 'call_debit_vertical';
      for (const long of listed(buyable, expiry, right)) {
        drafts.push(
          viewDraft(`Long ${expiry} ${long.strike} ${right}`, family, [quotedLeg(ctx, 'view', long, 'buy', size)]),
        );
        for (const short of listed(sellable, expiry, right)) {
          const width = right === 'put' ? long.strike - short.strike : short.strike - long.strike;
          if (!(width > 0 && width <= maxWidth)) continue;
          drafts.push(
            viewDraft(`${expiry} ${long.strike}/${short.strike} ${right} debit spread`, vertical, [
              quotedLeg(ctx, 'view', long, 'buy', size),
              quotedLeg(ctx, 'view', short, 'sell', size),
            ]),
          );
        }
      }
    } else if (input.view === 'long_vol') {
      const forward = ctx.forwards.get(expiry) ?? input.spotUsd;
      const calls = listed(buyable, expiry, 'call');
      for (const put of listed(buyable, expiry, 'put')) {
        for (const call of calls) {
          const straddle = call.strike === put.strike;
          const strangle =
            put.strike < call.strike &&
            put.strike <= forward &&
            call.strike >= forward &&
            call.strike - put.strike <= maxWidth;
          if (!straddle && !strangle) continue;
          drafts.push(
            viewDraft(
              straddle ? `${expiry} ${put.strike} straddle` : `${expiry} ${put.strike}/${call.strike} strangle`,
              straddle ? 'long_straddle' : 'long_strangle',
              [quotedLeg(ctx, 'view', put, 'buy', size), quotedLeg(ctx, 'view', call, 'buy', size)],
            ),
          );
        }
      }
    }
  }
  return drafts;
}

function coverDrafts(
  ctx: Context,
  short: UncoveredShort,
  byKey: Map<string, StructureSearchContract>,
  buyable: Map<string, StructureSearchContract[]>,
): Draft[] {
  const drafts: Draft[] = [];
  const right = short.optionRight;
  const own = byKey.get(contractKey(short.expiry, short.strike, right));
  if (own != null && usableSide(own.buy, 'buy', ctx.input.maxSpreadPct) != null) {
    const label = `Buy back ${short.expiry} ${short.strike} ${right}`;
    drafts.push({
      label,
      family: 'buy_back_short',
      components: [{ role: 'repair', label }],
      legs: [quotedLeg(ctx, 'repair', own, 'buy', short.size)],
      coveredShorts: [short],
    });
  }
  const maxWidth = STRUCTURE_SEARCH_MAX_WIDTH * ctx.input.spotUsd;
  for (const contract of buyable.get(`${short.expiry}|${short.optionRight}`) ?? []) {
    const width =
      short.optionRight === 'call' ? contract.strike - short.strike : short.strike - contract.strike;
    if (!(width > 0 && width <= maxWidth)) continue;
    const label = `Cover ${short.expiry} ${short.strike} ${right} with ${contract.strike} ${right}`;
    drafts.push({
      label,
      family: 'cover_short',
      components: [{ role: 'repair', label }],
      legs: [quotedLeg(ctx, 'repair', contract, 'buy', short.size)],
      coveredShorts: [short],
    });
  }
  return drafts;
}

function proposedLegs(underlying: string, legs: QuotedLeg[]): ProposedStructureLeg[] {
  return legs.map((leg) => ({
    underlying,
    expiry: leg.contract.expiry,
    strike: leg.contract.strike,
    optionRight: leg.contract.right,
    side: leg.side,
    size: leg.size,
    venue: leg.quoteSide.venue,
    quote: leg.quoteSide.quote,
  }));
}

function decisiveLegs(draft: Draft): QuotedLeg[] {
  const trades = draft.legs.filter((leg) => leg.role === 'view');
  return trades.length > 0 ? trades : draft.legs;
}

function compareMoneyness(left: Draft, right: Draft): number {
  const leftValues = decisiveLegs(left).map((leg) => leg.moneyness);
  const rightValues = decisiveLegs(right).map((leg) => leg.moneyness);
  const maxGap = Math.max(...leftValues) - Math.max(...rightValues);
  if (maxGap !== 0) return maxGap;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const sumGap = sum(leftValues) - sum(rightValues);
  if (sumGap !== 0) return sumGap;
  return left.legs.length - right.legs.length || left.label.localeCompare(right.label);
}

function targetMoves(ctx: Context, draft: Draft): number[] {
  const { input } = ctx;
  const target = input.targetMovePct;
  if (input.view === 'long_vol') {
    const magnitude = Math.abs(target ?? DEFAULT_TARGET_MOVE_PCT);
    return [-magnitude, magnitude];
  }
  if (target != null) return [target];
  if (input.view === 'bearish') return [-DEFAULT_TARGET_MOVE_PCT];
  if (input.view === 'bullish') return [DEFAULT_TARGET_MOVE_PCT];
  const rights = new Set(draft.coveredShorts.map((short) => short.optionRight));
  if (rights.size === 1) return [rights.has('call') ? DEFAULT_TARGET_MOVE_PCT : -DEFAULT_TARGET_MOVE_PCT];
  return [-DEFAULT_TARGET_MOVE_PCT, DEFAULT_TARGET_MOVE_PCT];
}

function breakevens(legs: LegWithMark[], feesUsd: number, expiry: string, spotUsd: number): number[] {
  const horizonMs = expiryInstantMs(expiry);
  const low = spotUsd * (1 - 2 * STRUCTURE_SEARCH_STRIKE_BAND);
  const high = spotUsd * (1 + 2 * STRUCTURE_SEARCH_STRIKE_BAND);
  const grid = Array.from(
    { length: BREAKEVEN_GRID_STEPS + 1 },
    (_, index) => low + ((high - low) * index) / BREAKEVEN_GRID_STEPS,
  );
  for (const { leg } of legs) if (leg.strike > low && leg.strike < high) grid.push(leg.strike);
  const spots = [...new Set(grid)].sort((left, right) => left - right);
  const result: number[] = [];
  let previous: { spot: number; pnl: number } | null = null;
  for (const spot of spots) {
    const raw = pnlAtHorizon(legs, spot, horizonMs);
    if (raw == null) return [];
    const pnl = raw - feesUsd;
    if (previous != null && Math.sign(previous.pnl) !== Math.sign(pnl) && pnl !== 0) {
      const crossing =
        previous.pnl === 0
          ? previous.spot
          : previous.spot + ((spot - previous.spot) * -previous.pnl) / (pnl - previous.pnl);
      if (result.at(-1) !== crossing) result.push(crossing);
    }
    previous = { spot, pnl };
  }
  return result;
}

function searchLegs(draft: Draft, evaluation: StructureEvaluation): StructureSearchLeg[] {
  return draft.legs.map((leg, index) => {
    const evaluated = evaluation.legs[index] as EvaluatedProposedLeg;
    return {
      role: leg.role,
      side: leg.side,
      size: leg.size,
      expiry: leg.contract.expiry,
      strike: leg.contract.strike,
      optionRight: leg.contract.right,
      venue: leg.quoteSide.venue,
      executablePriceUsd: evaluated.executablePriceUsd,
      midUsd: evaluated.midUsd,
      feeUsd: evaluated.feeUsd,
      feeSource: evaluated.feeSource,
      spreadPct: spreadPct(leg.quoteSide.quote),
      sizeAtBest: leg.quoteSide.sizeAtBest,
    };
  });
}

function evaluateDraft(ctx: Context, draft: Draft, held: LegWithMark[]): StructureSearchCandidate | null {
  const { input } = ctx;
  const proposed = proposedLegs(input.underlying, draft.legs);
  const firstExpiry = decisiveLegs(draft).map((leg) => leg.contract.expiry).sort()[0] ?? '';
  const horizonDays = input.targetHorizonDays ?? Math.max(0, daysUntil(firstExpiry, input.nowMs));
  const moves = targetMoves(ctx, draft);
  const evaluation = evaluateStructure({
    held,
    proposed,
    nowMs: input.nowMs,
    horizonsDays: [horizonDays],
    spotMovesPct: moves,
    riskBudgetUsd: ctx.budget,
    heldWindows: ctx.heldWindows,
    includePayoffAtExpiries: false,
  });
  if (evaluation.status !== 'ok' || evaluation.combined == null || evaluation.totals == null) return null;
  const cells = evaluation.horizonScenarios?.cells ?? [];
  if (cells.length === 0) return null;

  const feesUsd = evaluation.totals.feesUsd;
  const candidateWithMarks = proposed.map((leg, index) =>
    proposedLegWithMark(leg, evaluation.legs[index] as EvaluatedProposedLeg, input.nowMs),
  );
  const horizonMs = input.nowMs + horizonDays * DAY_MS;
  let decisive: StructureSearchCandidate['target'] | null = null;
  for (const cell of cells) {
    const alone = pnlAtHorizon(candidateWithMarks, cell.spotUsd, horizonMs);
    if (alone == null) return null;
    const target = {
      horizonDays,
      spotMovePct: cell.spotMovePct,
      spotUsd: cell.spotUsd,
      bookPnlUsd: cell.pnlUsd,
      candidatePnlUsd: alone - feesUsd,
    };
    const worse = ctx.repairMode
      ? target.bookPnlUsd < (decisive?.bookPnlUsd ?? Number.POSITIVE_INFINITY)
      : target.candidatePnlUsd < (decisive?.candidatePnlUsd ?? Number.POSITIVE_INFINITY);
    if (decisive == null || worse) decisive = target;
  }
  if (decisive == null) return null;

  const worstLossUsd = evaluation.combined.worstLossUsd;
  const incremental = evaluation.incrementalWorstLossUsd;
  let score: number;
  if (ctx.repairMode) {
    score = worstLossUsd == null ? Number.NEGATIVE_INFINITY : decisive.bookPnlUsd / Math.max(-worstLossUsd, 1);
  } else {
    const riskUsd = held.length > 0 && incremental != null ? Math.min(incremental, 0) : worstLossUsd;
    score = riskUsd == null ? Number.NEGATIVE_INFINITY : decisive.candidatePnlUsd / Math.max(-riskUsd, 1);
  }

  const legs = searchLegs(draft, evaluation);
  const spreads = legs.flatMap((leg) => (leg.spreadPct == null ? [] : [leg.spreadPct]));
  const sizes = legs.flatMap((leg) => (leg.sizeAtBest == null ? [] : [leg.sizeAtBest]));
  const fits = evaluation.budget?.fits ?? false;

  return {
    label: draft.label,
    family: draft.family,
    components: draft.components,
    coveredShortLegIds: draft.coveredShorts.map((short) => short.legId),
    legs,
    netCostUsd: evaluation.totals.netCostUsd,
    worstLossUsd,
    incrementalWorstLossUsd: incremental,
    headroomUsd: evaluation.budget?.headroomUsd ?? null,
    fits,
    shortfallUsd: fits || worstLossUsd == null ? null : -worstLossUsd - ctx.budget,
    target: decisive,
    score,
    breakevens: {
      expiry: firstExpiry,
      spotsUsd: breakevens(candidateWithMarks, feesUsd, firstExpiry, input.spotUsd),
    },
    liquidity: {
      maxSpreadPct: spreads.length > 0 ? Math.max(...spreads) : null,
      minSizeAtBest: sizes.length > 0 ? Math.min(...sizes) : null,
      displayedSizeCovers: legs.every((leg) => leg.sizeAtBest == null || leg.sizeAtBest >= leg.size),
    },
  };
}

function byScore(left: StructureSearchCandidate, right: StructureSearchCandidate): number {
  if (left.score !== right.score) return right.score - left.score;
  return byLossThenSpread(left, right);
}

// A ratio rewards a loss spread over more risk, so losing packages rank by book P&L instead.
function byBookReward(left: StructureSearchCandidate, right: StructureSearchCandidate): number {
  const leftGains = left.target.bookPnlUsd > 0;
  const rightGains = right.target.bookPnlUsd > 0;
  if (leftGains !== rightGains) return leftGains ? -1 : 1;
  if (!leftGains && left.target.bookPnlUsd !== right.target.bookPnlUsd) {
    return right.target.bookPnlUsd - left.target.bookPnlUsd;
  }
  return byScore(left, right);
}

function byLossThenSpread(left: StructureSearchCandidate, right: StructureSearchCandidate): number {
  const leftLoss = left.worstLossUsd ?? Number.NEGATIVE_INFINITY;
  const rightLoss = right.worstLossUsd ?? Number.NEGATIVE_INFINITY;
  if (leftLoss !== rightLoss) return rightLoss - leftLoss;
  const leftSpread = left.liquidity.maxSpreadPct ?? Number.POSITIVE_INFINITY;
  const rightSpread = right.liquidity.maxSpreadPct ?? Number.POSITIVE_INFINITY;
  if (leftSpread !== rightSpread) return leftSpread - rightSpread;
  return left.label.localeCompare(right.label);
}

function byShortfall(left: StructureSearchCandidate, right: StructureSearchCandidate): number {
  const gap = (left.shortfallUsd ?? Infinity) - (right.shortfallUsd ?? Infinity);
  return gap !== 0 ? gap : byLossThenSpread(left, right);
}

/** Lowest book-wide loss when this short alone is paired with each candidate cover. */
function cheapestCover(
  ctx: Context,
  short: UncoveredShort,
  drafts: Draft[],
  held: LegWithMark[],
): { draft: Draft; worstLossUsd: number } | null {
  const shortLeg = held.filter(({ leg }) => leg.legId === short.legId);
  let best: { draft: Draft; worstLossUsd: number; netCostUsd: number } | null = null;
  for (const draft of drafts) {
    const evaluation = evaluateStructure({
      held: shortLeg,
      proposed: proposedLegs(ctx.input.underlying, draft.legs),
      nowMs: ctx.input.nowMs,
      horizonsDays: [0],
      spotMovesPct: [0],
      includePayoffAtExpiries: false,
    });
    const worst = evaluation.combined?.worstLossUsd;
    const netCostUsd = evaluation.totals?.netCostUsd;
    if (evaluation.status !== 'ok' || worst == null || netCostUsd == null) continue;
    if (
      best == null ||
      worst > best.worstLossUsd ||
      (worst === best.worstLossUsd && netCostUsd < best.netCostUsd)
    ) {
      best = { draft, worstLossUsd: worst, netCostUsd };
    }
  }
  return best;
}

function combineDrafts(label: string, family: StructureSearchFamily, parts: Draft[]): Draft {
  return {
    label,
    family,
    components: [{ role: 'repair', label }],
    legs: parts.flatMap((part) => part.legs),
    coveredShorts: parts.flatMap((part) => part.coveredShorts),
  };
}

// Closing trades the user's own position, so any executable price counts regardless of maxSpreadPct.
function closingLeg(
  ctx: Context,
  byKey: Map<string, StructureSearchContract>,
  leg: { expiry: string; strike: number; optionRight: OptionRight; size: number },
): QuotedLeg | null {
  const contract = byKey.get(contractKey(leg.expiry, leg.strike, leg.optionRight));
  const direction = leg.size < 0 ? 'buy' : 'sell';
  const side = contract?.[direction];
  if (contract == null || side == null) return null;
  const price = direction === 'buy' ? side.quote.askUsd : side.quote.bidUsd;
  if (!(price != null && price > 0) || !(side.quote.iv != null && side.quote.iv > 0)) return null;
  return quotedLeg(ctx, 'repair', contract, direction, Math.abs(leg.size));
}

function legName(leg: QuotedLeg): string {
  return `${leg.side} ${leg.contract.expiry} ${leg.contract.strike} ${leg.contract.right}`;
}

/**
 * Repairs for a held book that is unbounded or over budget: the cheapest same-expiry cover of each
 * uncovered short, buying the shorts back, and closing the whole book.
 */
function repairDrafts(
  ctx: Context,
  heldBook: NonNullable<StructureSearchResult['heldBook']>,
  held: LegWithMark[],
  byKey: Map<string, StructureSearchContract>,
  buyable: Map<string, StructureSearchContract[]>,
): RepairDraft[] {
  const shorts = heldBook.upsideUnbounded
    ? heldBook.uncoveredShorts.filter((short) => short.exposure === 'upside_unbounded')
    : heldBook.uncoveredShorts;
  const drafts: RepairDraft[] = [];

  if (shorts.length > 0) {
    const best = shorts.map((short) =>
      cheapestCover(
        ctx,
        short,
        coverDrafts(ctx, short, byKey, buyable).filter((draft) => draft.family === 'cover_short'),
        held,
      ),
    );
    if (best.every((item) => item != null)) {
      const parts = best.map((item) => item.draft);
      drafts.push({
        ...combineDrafts(parts.map((part) => part.label).join(' + '), 'cover_all_shorts', parts),
        kind: 'cover',
      });
    }
  }

  const shortLegs = held.filter(({ leg }) => leg.size < -SIZE_EPSILON).map(({ leg }) => leg);
  const toBuyBack =
    shorts.length > 0
      ? shorts.map((short) => ({ ...short, size: -short.size, coveredShorts: [short] }))
      : shortLegs.map((leg) => ({ ...leg, coveredShorts: [] as UncoveredShort[] }));
  const buyBacks = toBuyBack.map((leg) => closingLeg(ctx, byKey, leg));
  if (toBuyBack.length > 0 && buyBacks.every((leg) => leg != null)) {
    const label = buyBacks.map((leg) => `Buy back ${leg.contract.expiry} ${leg.contract.strike} ${leg.contract.right}`).join(' + ');
    drafts.push({
      label,
      family: 'buy_back_short',
      kind: 'buy_back',
      components: [{ role: 'repair', label }],
      legs: buyBacks,
      coveredShorts: toBuyBack.flatMap((leg) => leg.coveredShorts),
    });
  }

  const closes = held.filter(({ leg }) => Math.abs(leg.size) > SIZE_EPSILON).map(({ leg }) => closingLeg(ctx, byKey, leg));
  const sameAsBuyBack = closes.length === buyBacks.length && held.every(({ leg }) => leg.size < 0);
  if (closes.length > 0 && closes.every((leg) => leg != null) && !sameAsBuyBack) {
    const label = `Close book: ${closes.map(legName).join(', ')}`;
    drafts.push({
      label,
      family: 'buy_back_short',
      kind: 'close_book',
      components: [{ role: 'repair', label }],
      legs: closes,
      coveredShorts: shorts,
    });
  }
  return drafts;
}

function evaluateRepair(ctx: Context, draft: RepairDraft, held: LegWithMark[]): StructureSearchRepairOption | null {
  const evaluation = evaluateStructure({
    held,
    proposed: proposedLegs(ctx.input.underlying, draft.legs),
    nowMs: ctx.input.nowMs,
    horizonsDays: [0],
    spotMovesPct: [0],
    riskBudgetUsd: ctx.budget,
    heldWindows: ctx.heldWindows,
    includePayoffAtExpiries: false,
  });
  if (evaluation.status !== 'ok' || evaluation.totals == null || evaluation.combined == null) return null;
  const bookWorstLossUsd = evaluation.combined.worstLossUsd;
  const fits = evaluation.budget?.fits ?? false;
  return {
    label: draft.label,
    kind: draft.kind,
    legs: searchLegs(draft, evaluation),
    netCostUsd: evaluation.totals.netCostUsd,
    bookWorstLossUsd,
    headroomUsd: evaluation.budget?.headroomUsd ?? null,
    fits,
    shortfallUsd: fits || bookWorstLossUsd == null ? null : -bookWorstLossUsd - ctx.budget,
  };
}

function byRepairQuality(left: StructureSearchRepairOption, right: StructureSearchRepairOption): number {
  const gap = (right.bookWorstLossUsd ?? Number.NEGATIVE_INFINITY) - (left.bookWorstLossUsd ?? Number.NEGATIVE_INFINITY);
  return gap !== 0 ? gap : left.netCostUsd - right.netCostUsd;
}

/**
 * Enumerates candidate structures for a view from an executable quote grid, evaluates each
 * against the held book with `evaluateStructure`, keeps those whose book-wide worst loss fits
 * `maxTotalRiskUsd`, and ranks them by candidate P&L at the target move and horizon divided
 * by the risk the candidate adds. When the held book is unbounded or over budget, a view is
 * also offered as packages: the best repair of the book plus the view structure, evaluated
 * together and ranked by book P&L at the target. When nothing fits, the closest candidates
 * are returned with their shortfall.
 */
export function searchStructures(input: StructureSearchInput): StructureSearchResult {
  const clock = input.clock ?? (() => performance.now());
  const startedAt = clock();
  const budget = input.maxTotalRiskUsd;
  const limit = Math.max(1, Math.min(STRUCTURE_SEARCH_MAX_LIMIT, Math.floor(input.limit)));
  const held = input.held.filter(({ leg }) => leg.underlying === input.underlying);
  const forwards = new Map<string, number>();
  for (const contract of input.contracts) {
    if (forwards.has(contract.expiry)) continue;
    const quote = contract.buy?.quote ?? contract.sell?.quote;
    const forward = quote?.forwardPriceUsd ?? quote?.underlyingPriceUsd ?? null;
    if (forward != null && forward > 0) forwards.set(contract.expiry, forward);
  }
  const ctx: Context = { input, budget, forwards, repairMode: false, heldWindows: undefined };
  const stats: StructureSearchResult['stats'] = {
    contracts: input.contracts.length,
    illiquidSides: 0,
    enumerated: 0,
    skippedUnbounded: 0,
    evaluated: 0,
    failedEvaluations: 0,
    fitting: 0,
    repairsEvaluated: 0,
    stoppedEarly: false,
  };
  const notes: string[] = [];
  const base = {
    view: input.view,
    maxTotalRiskUsd: budget,
    spotUsd: input.spotUsd,
    repair: null,
    repairOnly: null,
    rankedBy: 'reward_to_risk' as const,
    candidates: [],
    nearestInfeasible: [],
    stats,
    notes,
    assumptions: [...STRUCTURE_ASSUMPTIONS],
  };

  let heldBook: StructureSearchResult['heldBook'] = null;
  if (held.length > 0) {
    const windows = analyzeExpiryStructure(held, input.nowMs);
    const uncovered = findUncoveredShorts(held, input.nowMs);
    if (windows == null || uncovered == null) {
      return { ...base, status: 'missing_marks', heldBook: null };
    }
    ctx.heldWindows = windows;
    const summary = summarizeRisk(windows, 0);
    heldBook = {
      legCount: held.length,
      worstLossUsd: summary.worstLossUsd,
      upsideUnbounded: summary.upsideUnbounded,
      unboundedAfter: summary.unboundedAfter,
      uncoveredShorts: uncovered,
    };
  }
  if (input.view === 'hedge_held_shorts' && heldBook == null) {
    return { ...base, status: 'no_held_book', heldBook };
  }

  const byKey = new Map<string, StructureSearchContract>();
  const buyable = new Map<string, StructureSearchContract[]>();
  const sellable = new Map<string, StructureSearchContract[]>();
  for (const contract of input.contracts) {
    byKey.set(contractKey(contract.expiry, contract.strike, contract.right), contract);
    const forward = forwards.get(contract.expiry) ?? input.spotUsd;
    if (Math.abs(contract.strike / forward - 1) > STRUCTURE_SEARCH_STRIKE_BAND) continue;
    const group = `${contract.expiry}|${contract.right}`;
    for (const [direction, map] of [
      ['buy', buyable],
      ['sell', sellable],
    ] as const) {
      if (usableSide(contract[direction], direction, input.maxSpreadPct) == null) {
        if (contract[direction] != null) stats.illiquidSides += 1;
        continue;
      }
      const list = map.get(group) ?? [];
      list.push(contract);
      map.set(group, list);
    }
  }
  for (const map of [buyable, sellable]) {
    for (const list of map.values()) list.sort((left, right) => left.strike - right.strike);
  }

  const shorts = heldBook?.uncoveredShorts ?? [];
  const drafts: Draft[] = [];
  let repair: StructureSearchRepair | null = null;

  if (input.view === 'hedge_held_shorts') {
    if (shorts.length === 0) return { ...base, status: 'no_uncovered_shorts', heldBook };
    const perShort = shorts.map((short) => coverDrafts(ctx, short, byKey, buyable));
    drafts.push(...perShort.flat());
    if (shorts.length > 1) {
      const best = shorts.map((short, index) => cheapestCover(ctx, short, perShort[index] ?? [], held));
      if (best.every((item) => item != null)) {
        const parts = best.map((item) => item.draft);
        drafts.push(combineDrafts(parts.map((part) => part.label).join(' + '), 'cover_all_shorts', parts));
      }
    }
  } else {
    const trades = tradeDrafts(ctx, buyable, sellable);
    drafts.push(...trades);
    const reason =
      heldBook == null
        ? null
        : heldBook.upsideUnbounded
          ? ('unbounded' as const)
          : heldBook.worstLossUsd != null && heldBook.worstLossUsd < -budget
            ? ('over_budget' as const)
            : null;
    if (heldBook != null && reason != null) {
      ctx.repairMode = true;
      const options = repairDrafts(ctx, heldBook, held, byKey, buyable).flatMap((draft) => {
        const option = evaluateRepair(ctx, draft, held);
        return option == null ? [] : [{ draft, option }];
      });
      stats.repairsEvaluated = options.length;
      const bounded = options.filter(({ option }) => option.bookWorstLossUsd != null);
      bounded.sort((left, right) => byRepairQuality(left.option, right.option));
      const chosen = bounded[0];
      if (chosen == null) {
        notes.push('No executable repair (cover, buy-back or close) bounds the held book, so no packages were built.');
      } else {
        repair = {
          reason,
          chosen: chosen.option,
          considered: options.map(({ option }) => option).sort(byRepairQuality),
        };
        for (const trade of trades) {
          drafts.push({
            label: `${chosen.draft.label} + ${trade.label}`,
            family: trade.family,
            components: [
              { role: 'repair', label: chosen.draft.label },
              { role: 'view', label: trade.label },
            ],
            legs: [...chosen.draft.legs, ...trade.legs],
            coveredShorts: chosen.draft.coveredShorts,
          });
        }
      }
    }
  }

  stats.enumerated = drafts.length;
  // Only an added long call can bound a book whose upside is already unbounded.
  const viable = heldBook?.upsideUnbounded
    ? drafts.filter((draft) => draft.legs.some((leg) => leg.side === 'buy' && leg.contract.right === 'call'))
    : drafts;
  stats.skippedUnbounded = drafts.length - viable.length;
  const pool = [...viable].sort(compareMoneyness).slice(0, STRUCTURE_SEARCH_MAX_CANDIDATES);
  if (stats.skippedUnbounded > 0) {
    notes.push(
      `${stats.skippedUnbounded} candidates add no long call, so they cannot bound the held book's upside and were not evaluated.`,
    );
  }
  if (viable.length > pool.length) {
    notes.push(
      `${viable.length} candidates were eligible; the ${pool.length} nearest the money were evaluated.`,
    );
  }

  const evaluated: StructureSearchCandidate[] = [];
  for (const draft of pool) {
    if (clock() - startedAt > STRUCTURE_SEARCH_TIME_BUDGET_MS) {
      stats.stoppedEarly = true;
      notes.push(
        `Evaluation stopped at the ${STRUCTURE_SEARCH_TIME_BUDGET_MS / 1_000}s time budget after ${evaluated.length + stats.failedEvaluations} of ${pool.length} candidates, nearest the money first. Narrow minDte/maxDte for a fuller search.`,
      );
      break;
    }
    const candidate = evaluateDraft(ctx, draft, held);
    if (candidate == null) {
      stats.failedEvaluations += 1;
      continue;
    }
    evaluated.push(candidate);
  }
  stats.evaluated = evaluated.length;
  const fitting = evaluated
    .filter((candidate) => candidate.fits)
    .sort(ctx.repairMode ? byBookReward : byScore);
  stats.fitting = fitting.length;
  const nearestInfeasible =
    fitting.length > 0
      ? []
      : evaluated
          .filter((candidate) => candidate.worstLossUsd != null)
          .sort(byShortfall)
          .slice(0, 3);
  if (fitting.length === 0 && nearestInfeasible.length === 0 && stats.enumerated > 0) {
    notes.push('No candidate bounds the book: every one leaves upside loss unbounded.');
  }

  return {
    ...base,
    status: 'ok',
    heldBook,
    repair,
    repairOnly: repair != null && fitting.length === 0 ? repair.chosen : null,
    rankedBy: ctx.repairMode ? 'book_reward_to_risk' : 'reward_to_risk',
    candidates: fitting.slice(0, limit),
    nearestInfeasible,
  };
}
