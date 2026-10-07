import type { ExpiryRiskWindow, PositionLeg } from '@oggregator/protocol';

import type { VenueId } from '../types/common.js';
import { analyzeExpiryStructure } from './expiry-structure.js';
import { expiryInstantMs } from './horizon-valuation.js';
import { buildPortfolioHorizonScenarios } from './pnl-curve.js';
import type { MarkContext } from './types.js';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

export interface ProposedLegQuote {
  bidUsd: number | null;
  askUsd: number | null;
  midUsd: number | null;
  iv: number | null;
  underlyingPriceUsd: number | null;
  forwardPriceUsd: number | null;
  /** Venue estimate for the side being executed, USD per contract of underlying. */
  feePerContractUsd?: number | null;
}

export interface ProposedStructureLeg {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: PositionLeg['optionRight'];
  side: 'buy' | 'sell';
  size: number;
  venue?: VenueId | null;
  quote: ProposedLegQuote | null;
  /** Set when the caller could not resolve a quote; the leg is then reported, never priced. */
  quoteError?: string | null;
}

export interface EvaluateStructureInput {
  held: LegWithMark[];
  proposed: ProposedStructureLeg[];
  nowMs: number;
  horizonsDays: number[];
  spotMovesPct: number[];
  riskBudgetUsd?: number | null;
}

export interface EvaluatedProposedLeg {
  legId: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: PositionLeg['optionRight'];
  side: 'buy' | 'sell';
  size: number;
  venue: VenueId | null;
  executablePriceUsd: number | null;
  midUsd: number | null;
  iv: number | null;
  /** Signed cash: positive is paid (debit), negative received (credit). */
  premiumUsd: number | null;
  spreadCostUsd: number | null;
  feeUsd: number | null;
  feeSource: 'quote' | 'default_estimate';
  error: string | null;
}

export interface StructureRiskSummary {
  riskWindows: ExpiryRiskWindow[];
  worstLossUsd: number | null;
  upsideUnbounded: boolean;
  unboundedAfter: string | null;
}

export type IncrementalBasis = 'bounded' | 'combined_unbounded' | 'held_unbounded' | 'both_unbounded';

export interface StructureScenarioCell {
  horizonDays: number;
  spotMovePct: number;
  spotUsd: number;
  pnlUsd: number;
}

export interface StructurePayoffAtExpiry {
  expiry: string;
  points: Array<{ spotMovePct: number; spotUsd: number; pnlUsd: number }>;
}

export interface StructureBudget {
  riskBudgetUsd: number;
  worstLossUsd: number | null;
  headroomUsd: number | null;
  fits: boolean;
}

export type StructureEvaluationStatus =
  | 'ok'
  | 'quote_error'
  | 'missing_marks'
  | 'mixed_underlyings'
  | 'empty';

export interface StructureEvaluation {
  status: StructureEvaluationStatus;
  underlying: string | null;
  currentSpotUsd: number | null;
  legs: EvaluatedProposedLeg[];
  totals: {
    netPremiumUsd: number;
    midPremiumUsd: number | null;
    spreadCostUsd: number;
    feesUsd: number;
    netCostUsd: number;
  } | null;
  combined: StructureRiskSummary | null;
  heldOnly: StructureRiskSummary | null;
  incrementalWorstLossUsd: number | null;
  incrementalBasis: IncrementalBasis | null;
  horizonScenarios: {
    horizonsDays: number[];
    spotMovesPct: number[];
    cells: StructureScenarioCell[];
  } | null;
  payoffAtExpiries: StructurePayoffAtExpiry[];
  budget: StructureBudget | null;
  assumptions: string[];
}

const DAY_MS = 86_400_000;
// Highest standard taker rate among venues without per-instrument fees (OKX, Bybit, Binance:
// 0.05% of underlying) with the 12.5% premium cap most venues apply (see FEE_CAP in sdk-base).
export const DEFAULT_TAKER_FEE_RATE = 0.0005;
export const DEFAULT_TAKER_FEE_PREMIUM_CAP = 0.125;
const PAYOFF_SPOT_MOVES_PCT = [-20, -15, -10, -5, 0, 5, 10, 15, 20];

export const STRUCTURE_ASSUMPTIONS = [
  'Current IV held constant for every leg until its expiry.',
  'Single spot path across expiries: legs that expired earlier settle at the same spot that is evaluated later.',
  'P&L is against entry: held legs at their recorded entry price, proposed legs at the executable side (buy at ask, sell at bid), net of estimated proposed-leg fees.',
  'Legs without a venue fee estimate use a conservative default taker fee: min(0.05% of underlying, 12.5% of premium) per contract (feeSource "default_estimate").',
  'Executable quotes are as of retrieval and are not guaranteed fills; displayed size may be smaller than the requested size.',
  'Worst loss is negative for a loss; null means the loss is unbounded as spot rises.',
  'European exercise; no margin, funding or liquidation paths.',
] as const;

function legError(leg: ProposedStructureLeg): string | null {
  if (leg.quoteError != null) return leg.quoteError;
  const quote = leg.quote;
  if (quote == null) return 'No quote.';
  if (leg.side === 'buy' && !(quote.askUsd != null && quote.askUsd > 0)) return 'No executable ask.';
  if (leg.side === 'sell' && !(quote.bidUsd != null && quote.bidUsd > 0)) return 'No executable bid.';
  if (!(quote.iv != null && quote.iv > 0)) return 'No IV to reprice the leg before expiry.';
  if (!(Number.isFinite(leg.size) && leg.size > 0)) return 'Size must be positive.';
  return null;
}

function midOf(quote: ProposedLegQuote | null): number | null {
  if (quote == null) return null;
  if (quote.midUsd != null && quote.midUsd > 0) return quote.midUsd;
  if (quote.bidUsd != null && quote.askUsd != null && quote.bidUsd > 0 && quote.askUsd > 0) {
    return (quote.bidUsd + quote.askUsd) / 2;
  }
  return null;
}

/** Per contract. Without an underlying price the premium cap alone bounds the fee from above. */
export function defaultTakerFeeUsd(premiumUsd: number, underlyingPriceUsd: number | null): number {
  const cap = DEFAULT_TAKER_FEE_PREMIUM_CAP * Math.max(0, premiumUsd);
  return underlyingPriceUsd != null && underlyingPriceUsd > 0
    ? Math.min(DEFAULT_TAKER_FEE_RATE * underlyingPriceUsd, cap)
    : cap;
}

function evaluateLeg(leg: ProposedStructureLeg, index: number): EvaluatedProposedLeg {
  const error = legError(leg);
  const quote = leg.quote;
  const mid = midOf(quote);
  const executable = error == null ? (leg.side === 'buy' ? quote?.askUsd : quote?.bidUsd) ?? null : null;
  const venueFee = quote?.feePerContractUsd;
  const feeSource = venueFee != null && venueFee >= 0 ? 'quote' : 'default_estimate';
  const feePerContract =
    feeSource === 'quote'
      ? (venueFee ?? 0)
      : defaultTakerFeeUsd(
          executable ?? 0,
          quote?.underlyingPriceUsd ?? quote?.forwardPriceUsd ?? null,
        );
  const sign = leg.side === 'buy' ? 1 : -1;
  return {
    legId: `proposed-${index + 1}`,
    underlying: leg.underlying,
    expiry: leg.expiry,
    strike: leg.strike,
    optionRight: leg.optionRight,
    side: leg.side,
    size: leg.size,
    venue: leg.venue ?? null,
    executablePriceUsd: executable,
    midUsd: mid,
    iv: quote?.iv ?? null,
    premiumUsd: executable == null ? null : sign * executable * leg.size,
    spreadCostUsd:
      executable == null || mid == null ? null : sign * (executable - mid) * leg.size,
    feeUsd: error == null ? feePerContract * leg.size : null,
    feeSource,
    error,
  };
}

export function proposedLegWithMark(
  leg: ProposedStructureLeg,
  evaluated: EvaluatedProposedLeg,
  nowMs: number,
): LegWithMark {
  const quote = leg.quote;
  const price = evaluated.executablePriceUsd ?? 0;
  return {
    leg: {
      legId: evaluated.legId,
      underlying: leg.underlying,
      expiry: leg.expiry,
      strike: leg.strike,
      optionRight: leg.optionRight,
      size: leg.side === 'buy' ? leg.size : -leg.size,
      entryPriceUsd: price,
      entryIv: quote?.iv ?? null,
      realizedPnlUsd: 0,
      entryTs: nowMs,
      venueHint: leg.venue ?? null,
      source: 'manual',
    },
    mark: {
      underlyingPriceUsd: quote?.underlyingPriceUsd ?? null,
      forwardPriceUsd: quote?.forwardPriceUsd ?? null,
      markPriceUsd: evaluated.midUsd,
      iv: quote?.iv ?? null,
      delta: null,
      gamma: null,
      vega: null,
      theta: null,
      yearsToExpiry: null,
    },
  };
}

export function summarizeRisk(windows: ExpiryRiskWindow[], feesUsd: number): StructureRiskSummary {
  const unbounded = windows.find((window) => window.upsideUnbounded);
  const losses = windows.flatMap((window) => window.worstLossUsd ?? []);
  return {
    riskWindows: windows,
    worstLossUsd: unbounded != null ? null : losses.length > 0 ? Math.min(...losses) - feesUsd : 0 - feesUsd,
    upsideUnbounded: unbounded != null,
    unboundedAfter: unbounded?.from ?? null,
  };
}

function incremental(
  combined: StructureRiskSummary,
  heldOnly: StructureRiskSummary,
): { value: number | null; basis: IncrementalBasis } {
  if (combined.worstLossUsd != null && heldOnly.worstLossUsd != null) {
    return { value: combined.worstLossUsd - heldOnly.worstLossUsd, basis: 'bounded' };
  }
  if (combined.worstLossUsd == null && heldOnly.worstLossUsd == null) {
    return { value: null, basis: 'both_unbounded' };
  }
  return {
    value: null,
    basis: combined.worstLossUsd == null ? 'combined_unbounded' : 'held_unbounded',
  };
}

function emptyEvaluation(
  status: StructureEvaluationStatus,
  legs: EvaluatedProposedLeg[],
  underlying: string | null,
): StructureEvaluation {
  return {
    status,
    underlying,
    currentSpotUsd: null,
    legs,
    totals: null,
    combined: null,
    heldOnly: null,
    incrementalWorstLossUsd: null,
    incrementalBasis: null,
    horizonScenarios: null,
    payoffAtExpiries: [],
    budget: null,
    assumptions: [...STRUCTURE_ASSUMPTIONS],
  };
}

/**
 * Prices proposed legs at executable quotes and evaluates them alone and against
 * the held book. Worst loss is the lowest single-path P&L across expiry windows,
 * measured from entry (so it already contains the spread paid) minus the fees of
 * the proposed legs. Held-leg fees are sunk and not re-counted.
 */
export function evaluateStructure(input: EvaluateStructureInput): StructureEvaluation {
  const legs = input.proposed.map((leg, index) => evaluateLeg(leg, index));
  const underlying = input.proposed[0]?.underlying ?? input.held[0]?.leg.underlying ?? null;
  if (input.proposed.length === 0) return emptyEvaluation('empty', legs, underlying);
  if (legs.some((leg) => leg.error != null)) return emptyEvaluation('quote_error', legs, underlying);
  if (
    input.proposed.some((leg) => leg.underlying !== underlying) ||
    input.held.some(({ leg }) => leg.underlying !== underlying)
  ) {
    return emptyEvaluation('mixed_underlyings', legs, underlying);
  }

  const proposedWithMarks = input.proposed.map((leg, index) =>
    proposedLegWithMark(leg, legs[index] as EvaluatedProposedLeg, input.nowMs),
  );
  const combinedWithMarks = [...input.held, ...proposedWithMarks];
  const combinedWindows = analyzeExpiryStructure(combinedWithMarks, input.nowMs);
  const heldWindows =
    input.held.length === 0 ? [] : analyzeExpiryStructure(input.held, input.nowMs);
  if (combinedWindows == null || heldWindows == null) {
    return emptyEvaluation('missing_marks', legs, underlying);
  }

  const feesUsd = legs.reduce((sum, leg) => sum + (leg.feeUsd ?? 0), 0);
  const netPremiumUsd = legs.reduce((sum, leg) => sum + (leg.premiumUsd ?? 0), 0);
  const midPremiums = legs.map((leg) =>
    leg.midUsd == null ? null : (leg.side === 'buy' ? 1 : -1) * leg.midUsd * leg.size,
  );
  const midPremiumUsd = midPremiums.every((value) => value != null)
    ? midPremiums.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const spreadCostUsd = legs.reduce((sum, leg) => sum + (leg.spreadCostUsd ?? 0), 0);

  const combined = summarizeRisk(combinedWindows, feesUsd);
  const heldOnly = summarizeRisk(heldWindows, 0);
  const delta = incremental(combined, heldOnly);

  const scenarios = buildPortfolioHorizonScenarios(
    combinedWithMarks,
    input.nowMs,
    input.horizonsDays,
    input.spotMovesPct,
  );
  if (scenarios.status !== 'ok') return emptyEvaluation('missing_marks', legs, underlying);

  const expiries = [...new Set(combinedWithMarks.map(({ leg }) => leg.expiry))]
    .filter((expiry) => expiryInstantMs(expiry) > input.nowMs)
    .sort();
  const payoffAtExpiries: StructurePayoffAtExpiry[] = [];
  for (const expiry of expiries) {
    const horizonDays = (expiryInstantMs(expiry) - input.nowMs) / DAY_MS;
    const payoff = buildPortfolioHorizonScenarios(
      combinedWithMarks,
      input.nowMs,
      [horizonDays],
      PAYOFF_SPOT_MOVES_PCT,
    );
    if (payoff.status !== 'ok') return emptyEvaluation('missing_marks', legs, underlying);
    payoffAtExpiries.push({
      expiry,
      points: payoff.cells.map((cell) => ({
        spotMovePct: cell.spotMovePct,
        spotUsd: cell.spotUsd,
        pnlUsd: cell.pnlUsd - feesUsd,
      })),
    });
  }

  const riskBudgetUsd = input.riskBudgetUsd;
  const budget: StructureBudget | null =
    riskBudgetUsd == null
      ? null
      : {
          riskBudgetUsd,
          worstLossUsd: combined.worstLossUsd,
          headroomUsd:
            combined.worstLossUsd == null ? null : riskBudgetUsd + combined.worstLossUsd,
          fits: combined.worstLossUsd != null && combined.worstLossUsd >= -riskBudgetUsd,
        };

  return {
    status: 'ok',
    underlying,
    currentSpotUsd: scenarios.currentSpotUsd,
    legs,
    totals: {
      netPremiumUsd,
      midPremiumUsd,
      spreadCostUsd,
      feesUsd,
      netCostUsd: netPremiumUsd + feesUsd,
    },
    combined,
    heldOnly,
    incrementalWorstLossUsd: delta.value,
    incrementalBasis: delta.basis,
    horizonScenarios: {
      horizonsDays: scenarios.horizonsDays,
      spotMovesPct: scenarios.spotMovesPct,
      cells: scenarios.cells.map((cell) => ({
        horizonDays: cell.horizonDays,
        spotMovePct: cell.spotMovePct,
        spotUsd: cell.spotUsd,
        pnlUsd: cell.pnlUsd - feesUsd,
      })),
    },
    payoffAtExpiries,
    budget,
    assumptions: [...STRUCTURE_ASSUMPTIONS],
  };
}
