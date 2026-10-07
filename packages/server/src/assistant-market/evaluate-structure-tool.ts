import {
  type EvaluateStructureInput,
  evaluateStructure,
  type ProposedLegQuote,
  type ProposedStructureLeg,
  type StructureEvaluation,
  type StructureRiskSummary,
  type VenueId,
} from '@oggregator/core';
import { VENUE_IDS } from '@oggregator/protocol';
import { z } from 'zod';

import type { ExecutableQuoteSet, VenueExecutableQuote } from './market-data-compaction.js';
import type { AssistantMarketDataReader, MarketReadResult } from './market-data-reader.js';
import type { PortfolioRefScope, PortfolioRefStore } from './portfolio-ref.js';

export type HeldLegsWithMarks = EvaluateStructureInput['held'];

export interface StructureToolPortfolioAccess {
  refs: PortfolioRefStore;
  resolveHeldLegs: (scope: PortfolioRefScope) => Promise<HeldLegsWithMarks | null>;
}

const DAY_MS = 86_400_000;
const DEFAULT_HORIZONS_DAYS = [0, 1, 3, 7, 14, 30];
const SCENARIO_SPOT_MOVES_PCT = [-10, -5, -2, 0, 2, 5, 10];

export const EvaluateStructureToolInputSchema = z.object({
  portfolioRef: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'portfolioRef from the latest portfolio context. Adds the held book server-side. Omit to evaluate the proposed legs alone.',
    ),
  underlying: z.string().min(1).max(20).describe('Underlying symbol, e.g. BTC.'),
  legs: z
    .array(
      z.object({
        expiry: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Listed expiry YYYY-MM-DD.'),
        strike: z.number().positive(),
        right: z.enum(['call', 'put']),
        side: z.enum(['buy', 'sell']),
        size: z.number().positive().max(10_000).describe('Contracts of underlying, positive.'),
        venue: z
          .enum(VENUE_IDS)
          .optional()
          .describe('Price on this venue only. Omit for the best executable quote across venues.'),
      }),
    )
    .min(1)
    .max(8)
    .describe('Proposed legs. To close a held leg, trade the opposite side with the same size.'),
  riskBudgetUsd: z
    .number()
    .positive()
    .max(100_000_000)
    .optional()
    .describe('Maximum acceptable book-wide loss in USD, as a positive number.'),
  horizonsDays: z
    .array(z.number().min(0).max(365))
    .min(1)
    .max(12)
    .optional()
    .describe('Scenario horizons in days. Defaults to 0, 1, 3, 7, 14, 30 plus each expiry.'),
});
export type EvaluateStructureToolInput = z.infer<typeof EvaluateStructureToolInputSchema>;

type ToolLeg = EvaluateStructureToolInput['legs'][number];

interface ResolvedQuote {
  quote: ProposedLegQuote;
  venue: string;
  echo: {
    venue: string;
    bidUsd: number | null;
    askUsd: number | null;
    bidSize: number | null;
    askSize: number | null;
    asOf: string | null;
    quotingVenues: number;
  };
}

function cents(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function fraction(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10_000) / 10_000;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function legLabel(underlying: string, leg: ToolLeg): string {
  return `${underlying} ${leg.expiry} ${leg.strike} ${leg.right}`;
}

function pickQuote(
  set: ExecutableQuoteSet,
  leg: ToolLeg,
): { ok: true; value: ResolvedQuote } | { ok: false; error: string } {
  const label = legLabel(set.underlying, leg);
  const row = set.quotes.find((item) => item.strike === leg.strike && item.right === leg.right);
  if (row == null || row.venues.length === 0) {
    return { ok: false, error: `No fresh quote for ${label}. Check the strike with oggregator_option_chain.` };
  }
  const candidates =
    leg.venue == null ? row.venues : row.venues.filter((quote) => quote.venue === leg.venue);
  if (candidates.length === 0) {
    return { ok: false, error: `No fresh ${leg.venue} quote for ${label}.` };
  }
  const priced = candidates.filter((quote) =>
    leg.side === 'buy' ? (quote.askUsd ?? 0) > 0 : (quote.bidUsd ?? 0) > 0,
  );
  const best = priced.reduce<VenueExecutableQuote | null>((current, quote) => {
    if (current == null) return quote;
    return leg.side === 'buy'
      ? (quote.askUsd ?? Infinity) < (current.askUsd ?? Infinity)
        ? quote
        : current
      : (quote.bidUsd ?? 0) > (current.bidUsd ?? 0)
        ? quote
        : current;
  }, null);
  if (best == null) {
    return {
      ok: false,
      error: `No executable ${leg.side === 'buy' ? 'ask' : 'bid'} for ${label}${leg.venue ? ` on ${leg.venue}` : ''}.`,
    };
  }
  const iv =
    best.markIv != null && best.markIv > 0
      ? best.markIv
      : median(row.venues.flatMap((quote) => (quote.markIv != null && quote.markIv > 0 ? [quote.markIv] : [])));
  return {
    ok: true,
    value: {
      venue: best.venue,
      quote: {
        bidUsd: best.bidUsd,
        askUsd: best.askUsd,
        midUsd: best.midUsd,
        iv,
        underlyingPriceUsd: best.underlyingPriceUsd ?? set.indexPriceUsd ?? set.forwardPriceUsd,
        forwardPriceUsd: set.forwardPriceUsd,
        feePerContractUsd: leg.side === 'buy' ? best.askTakerFeeUsd : best.bidTakerFeeUsd,
      },
      echo: {
        venue: best.venue,
        bidUsd: cents(best.bidUsd),
        askUsd: cents(best.askUsd),
        bidSize: best.bidSize,
        askSize: best.askSize,
        asOf: best.asOfMs == null ? null : new Date(best.asOfMs).toISOString(),
        quotingVenues: row.venues.length,
      },
    },
  };
}

function isVenueId(value: string): value is VenueId {
  return (VENUE_IDS as readonly string[]).includes(value);
}

function compactRisk(summary: StructureRiskSummary | null) {
  if (summary == null) return null;
  return {
    worstLossUsd: cents(summary.worstLossUsd),
    upsideUnbounded: summary.upsideUnbounded,
    unboundedAfter: summary.unboundedAfter,
    riskWindows: summary.riskWindows.map((window) => ({
      from: window.from,
      until: window.until,
      netCallSize: window.netCallSize,
      upsideUnbounded: window.upsideUnbounded,
      worstLossUsd: cents(window.worstLossUsd),
      worstLossSpotUsd: cents(window.worstLossSpotUsd),
    })),
  };
}

function defaultHorizons(nowMs: number, expiries: string[]): number[] {
  const expiryDays = expiries
    .map((expiry) => (Date.parse(`${expiry}T08:00:00.000Z`) - nowMs) / DAY_MS)
    .filter((days) => Number.isFinite(days) && days > 0)
    .map((days) => Math.round(days * 100) / 100);
  return [...new Set([...DEFAULT_HORIZONS_DAYS, ...expiryDays])].sort((a, b) => a - b);
}

function compactEvaluation(
  evaluation: StructureEvaluation,
  quotes: Array<ResolvedQuote['echo'] | null>,
  hasHeldBook: boolean,
) {
  const legs = evaluation.legs.map((leg, index) => ({
    leg: `${leg.side} ${leg.size} ${leg.underlying} ${leg.expiry} ${leg.strike} ${leg.optionRight}`,
    venue: leg.venue,
    executablePriceUsd: cents(leg.executablePriceUsd),
    midUsd: cents(leg.midUsd),
    iv: fraction(leg.iv),
    premiumUsd: cents(leg.premiumUsd),
    spreadCostUsd: cents(leg.spreadCostUsd),
    feeUsd: cents(leg.feeUsd),
    feeSource: leg.feeSource,
    quote: quotes[index] ?? null,
    error: leg.error,
  }));
  if (evaluation.status !== 'ok') {
    return { status: evaluation.status, underlying: evaluation.underlying, legs };
  }
  const totals = evaluation.totals;
  return {
    status: evaluation.status,
    underlying: evaluation.underlying,
    currentSpotUsd: cents(evaluation.currentSpotUsd),
    legs,
    totals:
      totals == null
        ? null
        : {
            netPremiumUsd: cents(totals.netPremiumUsd),
            midPremiumUsd: cents(totals.midPremiumUsd),
            spreadCostUsd: cents(totals.spreadCostUsd),
            feesUsd: cents(totals.feesUsd),
            netCostUsd: cents(totals.netCostUsd),
          },
    combined: compactRisk(evaluation.combined),
    heldOnly: hasHeldBook ? compactRisk(evaluation.heldOnly) : null,
    incrementalWorstLossUsd: cents(evaluation.incrementalWorstLossUsd),
    incrementalBasis: evaluation.incrementalBasis,
    budget:
      evaluation.budget == null
        ? null
        : {
            riskBudgetUsd: evaluation.budget.riskBudgetUsd,
            worstLossUsd: cents(evaluation.budget.worstLossUsd),
            headroomUsd: cents(evaluation.budget.headroomUsd),
            fits: evaluation.budget.fits,
          },
    horizonScenarios:
      evaluation.horizonScenarios == null
        ? null
        : {
            horizonsDays: evaluation.horizonScenarios.horizonsDays,
            spotMovesPct: evaluation.horizonScenarios.spotMovesPct,
            cells: evaluation.horizonScenarios.cells.map((cell) => ({
              horizonDays: cell.horizonDays,
              spotMovePct: cell.spotMovePct,
              spotUsd: cents(cell.spotUsd),
              pnlUsd: cents(cell.pnlUsd),
            })),
          },
    payoffAtExpiries: evaluation.payoffAtExpiries.map((row) => ({
      expiry: row.expiry,
      points: row.points.map((point) => ({
        spotMovePct: point.spotMovePct,
        spotUsd: cents(point.spotUsd),
        pnlUsd: cents(point.pnlUsd),
      })),
    })),
  };
}

export async function runEvaluateStructureTool(
  reader: AssistantMarketDataReader,
  portfolio: StructureToolPortfolioAccess,
  args: EvaluateStructureToolInput,
  nowMs: number,
): Promise<MarketReadResult<Record<string, unknown>>> {
  const underlying = args.underlying.trim().toUpperCase();
  let held: HeldLegsWithMarks = [];
  let scope: PortfolioRefScope | null = null;
  if (args.portfolioRef != null) {
    const resolved = portfolio.refs.resolve(args.portfolioRef);
    if (!resolved.ok) {
      return {
        ok: false,
        error:
          resolved.error === 'expired'
            ? 'portfolioRef has expired (15 minute lifetime). Ask the user to send the question again for a fresh portfolio context, or omit portfolioRef to evaluate the legs alone.'
            : 'portfolioRef is not recognised. Use the portfolioRef from the latest portfolio context, or omit it to evaluate the legs alone.',
      };
    }
    scope = resolved.scope;
    if (scope.underlying != null && scope.underlying.toUpperCase() !== underlying) {
      return {
        ok: false,
        error: `portfolioRef covers the ${scope.underlying} book, not ${underlying}.`,
      };
    }
    const legs = await portfolio.resolveHeldLegs(scope);
    if (legs == null) return { ok: false, error: 'The held portfolio could not be loaded.' };
    held = legs.filter(({ leg }) => leg.underlying === underlying);
  }

  const expiries = [...new Set(args.legs.map((leg) => leg.expiry))].sort();
  const quoteSets = new Map<string, MarketReadResult<ExecutableQuoteSet>>();
  await Promise.all(
    expiries.map(async (expiry) => {
      const strikes = args.legs.filter((leg) => leg.expiry === expiry).map((leg) => leg.strike);
      quoteSets.set(expiry, await reader.executableQuotes(underlying, expiry, strikes));
    }),
  );

  const echoes: Array<ResolvedQuote['echo'] | null> = [];
  const proposed: ProposedStructureLeg[] = args.legs.map((leg) => {
    const base = {
      underlying,
      expiry: leg.expiry,
      strike: leg.strike,
      optionRight: leg.right,
      side: leg.side,
      size: leg.size,
    };
    const set = quoteSets.get(leg.expiry);
    if (set == null || !set.ok) {
      echoes.push(null);
      return {
        ...base,
        venue: leg.venue ?? null,
        quote: null,
        quoteError: `Chain unavailable for ${underlying} ${leg.expiry}: ${set?.ok === false ? set.error : 'no data'}`,
      };
    }
    const picked = pickQuote(set.data, leg);
    if (!picked.ok) {
      echoes.push(null);
      return { ...base, venue: leg.venue ?? null, quote: null, quoteError: picked.error };
    }
    echoes.push(picked.value.echo);
    return {
      ...base,
      venue: isVenueId(picked.value.venue) ? picked.value.venue : null,
      quote: picked.value.quote,
    };
  });

  const evaluation = evaluateStructure({
    held,
    proposed,
    nowMs,
    horizonsDays:
      args.horizonsDays ??
      defaultHorizons(nowMs, [...expiries, ...held.map(({ leg }) => leg.expiry)]),
    spotMovesPct: SCENARIO_SPOT_MOVES_PCT,
    riskBudgetUsd: args.riskBudgetUsd ?? null,
  });

  const notes = [
    'worstLossUsd, horizon and expiry P&L include the spread paid (executable entry) and the proposed legs’ estimated fees.',
  ];
  if (evaluation.legs.some((leg) => leg.feeSource === 'default' && leg.error == null)) {
    notes.push('Legs with feeSource "default" had no venue fee estimate; their fee is counted as 0.');
  }
  if (evaluation.status === 'quote_error') {
    notes.push('Nothing was evaluated because at least one leg has no executable quote. Do not substitute a price.');
  }
  for (const [index, leg] of args.legs.entries()) {
    const echo = echoes[index];
    const shown = leg.side === 'buy' ? echo?.askSize : echo?.bidSize;
    if (shown != null && shown < leg.size) {
      notes.push(`Leg ${index + 1}: displayed size ${shown} is below the requested ${leg.size}.`);
    }
  }

  return {
    ok: true,
    data: {
      source: 'oggregator_evaluate_structure',
      evaluatedAt: new Date(nowMs).toISOString(),
      heldBook:
        scope == null
          ? { included: false, legCount: 0 }
          : {
              included: true,
              legCount: held.length,
              portfolioGeneratedAt: new Date(scope.generatedAt).toISOString(),
            },
      ...compactEvaluation(evaluation, echoes, scope != null),
      assumptions: evaluation.assumptions,
      notes,
    },
  };
}
