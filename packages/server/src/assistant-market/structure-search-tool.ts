import {
  findUncoveredShorts,
  searchStructures,
  STRUCTURE_SEARCH_MAX_LIMIT,
  STRUCTURE_SEARCH_STRIKE_BAND,
  type StructureSearchCandidate,
  type StructureSearchContract,
  type StructureSearchQuoteSide,
  type UncoveredShort,
} from '@oggregator/core';
import { VENUE_IDS } from '@oggregator/protocol';
import { z } from 'zod';

import { DEFAULT_FEE_NOTE } from './evaluate-structure-tool.js';
import type { ExecutableQuoteSet } from './market-data-compaction.js';
import type { AssistantMarketDataReader, MarketReadResult } from './market-data-reader.js';
import {
  cents,
  isVenueId,
  resolveHeldBook,
  selectExecutableQuote,
  type StructureToolPortfolioAccess,
} from './structure-tool-support.js';

export const STRUCTURE_SEARCH_MAX_EXPIRIES = 6;

export const StructureSearchToolInputSchema = z
  .object({
    portfolioRef: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        'portfolioRef from the latest portfolio context. Makes maxTotalRiskUsd a book-wide limit. Required for hedge_held_shorts.',
      ),
    underlying: z.string().min(1).max(20).describe('Underlying symbol, e.g. BTC.'),
    view: z
      .enum(['bearish', 'bullish', 'long_vol', 'hedge_held_shorts'])
      .describe(
        'bearish: long puts and put debit spreads. bullish: long calls and call debit spreads. long_vol: long straddles and strangles. hedge_held_shorts: buy back or cover each uncovered held short.',
      ),
    maxTotalRiskUsd: z
      .number()
      .positive()
      .max(100_000_000)
      .describe('Maximum worst loss in USD, positive. Book-wide with portfolioRef, else for the structure alone.'),
    minDte: z.number().min(0).max(365).default(1),
    maxDte: z.number().min(0).max(365).default(45),
    targetMovePct: z
      .number()
      .min(-90)
      .max(500)
      .optional()
      .describe('Spot move to rank by, in percent. Defaults: bearish -10, bullish +10, long_vol ±10 (weaker side).'),
    targetHorizonDays: z
      .number()
      .min(0)
      .max(365)
      .optional()
      .describe("Days ahead to rank at. Defaults to each candidate's first expiry."),
    venues: z
      .array(z.enum(VENUE_IDS))
      .min(1)
      .max(VENUE_IDS.length)
      .optional()
      .describe('Only price on these venues. Pass one venue to keep every leg on the same venue.'),
    maxSpreadPct: z
      .number()
      .positive()
      .max(500)
      .default(25)
      .describe('Skip contracts whose bid-ask spread exceeds this percent of mid.'),
    limit: z.number().int().min(1).max(STRUCTURE_SEARCH_MAX_LIMIT).default(5),
    size: z
      .number()
      .positive()
      .max(10_000)
      .default(1)
      .describe('Contracts per new leg. Covers always match the held short. Reduce for small budgets.'),
  })
  .refine((args) => args.maxDte >= args.minDte, 'maxDte must be at least minDte');
export type StructureSearchToolInput = z.infer<typeof StructureSearchToolInputSchema>;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function round(value: number | null | undefined, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function shortLabel(underlying: string, short: UncoveredShort): string {
  return `short ${short.size} ${underlying} ${short.expiry} ${short.strike} ${short.optionRight} (${short.exposure})`;
}

function compactCandidate(candidate: StructureSearchCandidate) {
  const venues = [...new Set(candidate.legs.map((leg) => leg.venue))];
  return {
    label: candidate.label,
    family: candidate.family,
    legs: candidate.legs.map((leg) => ({
      role: leg.role,
      side: leg.side,
      size: leg.size,
      expiry: leg.expiry,
      strike: leg.strike,
      right: leg.optionRight,
      venue: leg.venue,
      priceUsd: cents(leg.executablePriceUsd),
      feeUsd: cents(leg.feeUsd),
      feeSource: leg.feeSource,
      spreadPct: round(leg.spreadPct, 1),
      sizeAtBest: leg.sizeAtBest,
    })),
    sameVenue: venues.length === 1,
    netCostUsd: cents(candidate.netCostUsd),
    worstLossUsd: cents(candidate.worstLossUsd),
    incrementalWorstLossUsd: cents(candidate.incrementalWorstLossUsd),
    headroomUsd: cents(candidate.headroomUsd),
    fits: candidate.fits,
    shortfallUsd: cents(candidate.shortfallUsd),
    pnlAtTarget: {
      horizonDays: round(candidate.target.horizonDays, 2),
      spotMovePct: candidate.target.spotMovePct,
      spotUsd: cents(candidate.target.spotUsd),
      candidatePnlUsd: cents(candidate.target.candidatePnlUsd),
      bookPnlUsd: cents(candidate.target.bookPnlUsd),
    },
    rewardToRisk: round(candidate.score, 3),
    breakevens: {
      expiry: candidate.breakevens.expiry,
      spotsUsd: candidate.breakevens.spotsUsd.map((spot) => cents(spot)),
    },
    liquidity: {
      maxSpreadPct: round(candidate.liquidity.maxSpreadPct, 1),
      minSizeAtBest: candidate.liquidity.minSizeAtBest,
      displayedSizeCovers: candidate.liquidity.displayedSizeCovers,
    },
  };
}

function quoteSide(
  set: ExecutableQuoteSet,
  strike: number,
  right: 'call' | 'put',
  side: 'buy' | 'sell',
  venues: readonly string[] | undefined,
): StructureSearchQuoteSide | null {
  const picked = selectExecutableQuote(set, { strike, right, side, venues });
  if (!picked.ok) return null;
  return {
    quote: picked.value.quote,
    venue: isVenueId(picked.value.venue) ? picked.value.venue : null,
    sizeAtBest: side === 'buy' ? picked.value.echo.askSize : picked.value.echo.bidSize,
  };
}

function contractsFrom(set: ExecutableQuoteSet, venues: readonly string[] | undefined): StructureSearchContract[] {
  const contracts: StructureSearchContract[] = [];
  for (const row of set.quotes) {
    const buy = quoteSide(set, row.strike, row.right, 'buy', venues);
    const sell = quoteSide(set, row.strike, row.right, 'sell', venues);
    if (buy == null && sell == null) continue;
    contracts.push({ expiry: set.expiry, strike: row.strike, right: row.right, buy, sell });
  }
  return contracts;
}

export async function runStructureSearchTool(
  reader: AssistantMarketDataReader,
  portfolio: StructureToolPortfolioAccess,
  args: StructureSearchToolInput,
  nowMs: number,
): Promise<MarketReadResult<Record<string, unknown>>> {
  const underlying = args.underlying.trim().toUpperCase();
  if (args.view === 'hedge_held_shorts' && args.portfolioRef == null) {
    return { ok: false, error: 'view hedge_held_shorts needs the portfolioRef from the latest portfolio context.' };
  }
  const book = await resolveHeldBook(portfolio, args.portfolioRef, underlying, 'search without the held book');
  if (!book.ok) return book;
  const { held, scope } = book;

  const listing = await reader.listExpiries(underlying);
  if (!listing.ok) return listing;
  const listed = new Map(listing.data.expiries.map((row) => [row.expiry, row.daysToExpiry]));
  const shorts = findUncoveredShorts(held, nowMs) ?? [];
  const coverExpiries =
    args.view === 'long_vol' ? [] : [...new Set(shorts.map((short) => short.expiry))].filter((expiry) => listed.has(expiry));
  const windowExpiries =
    args.view === 'hedge_held_shorts'
      ? []
      : listing.data.expiries
          .filter((row) => row.daysToExpiry != null && row.daysToExpiry >= args.minDte && row.daysToExpiry <= args.maxDte)
          .map((row) => row.expiry);
  const wanted = [...new Set([...coverExpiries.sort(), ...windowExpiries.sort()])];
  const expiries = wanted.slice(0, STRUCTURE_SEARCH_MAX_EXPIRIES).sort();

  const notes: string[] = [];
  if (expiries.length < wanted.length) {
    notes.push(
      `${wanted.length - expiries.length} later expiries in the DTE window were not searched (limit ${STRUCTURE_SEARCH_MAX_EXPIRIES}). Narrow minDte/maxDte to reach them.`,
    );
  }
  if (expiries.length === 0) {
    return {
      ok: false,
      error: `No listed ${underlying} expiry between ${args.minDte} and ${args.maxDte} days. Check oggregator_list_expiries and widen the DTE window.`,
    };
  }

  const sets = await Promise.all(
    expiries.map(async (expiry) => {
      const strikes = shorts.filter((short) => short.expiry === expiry).map((short) => short.strike);
      return {
        expiry,
        result: await reader.executableQuotes(underlying, expiry, strikes, {
          forwardBand: STRUCTURE_SEARCH_STRIKE_BAND,
        }),
      };
    }),
  );
  const contracts: StructureSearchContract[] = [];
  const spots: number[] = [];
  for (const { expiry, result } of sets) {
    if (!result.ok) {
      notes.push(`Chain unavailable for ${underlying} ${expiry}: ${result.error}`);
      continue;
    }
    contracts.push(...contractsFrom(result.data, args.venues));
    const spot = result.data.indexPriceUsd ?? result.data.forwardPriceUsd;
    if (spot != null && spot > 0) spots.push(spot);
  }
  const spotUsd =
    median(spots) ??
    median(held.flatMap(({ mark }) => mark.underlyingPriceUsd ?? mark.forwardPriceUsd ?? []));
  if (spotUsd == null) return { ok: false, error: `No ${underlying} spot price is available to search around.` };

  const result = searchStructures({
    underlying,
    view: args.view,
    contracts,
    held,
    spotUsd,
    nowMs,
    maxTotalRiskUsd: args.maxTotalRiskUsd,
    minDte: args.minDte,
    maxDte: args.maxDte,
    targetMovePct: args.targetMovePct ?? null,
    targetHorizonDays: args.targetHorizonDays ?? null,
    maxSpreadPct: args.maxSpreadPct,
    limit: args.limit,
    size: args.size,
  });

  notes.push(...result.notes);
  if (result.status === 'no_held_book') notes.push(`The referenced portfolio has no ${underlying} legs to hedge.`);
  if (result.status === 'no_uncovered_shorts') notes.push('The held book has no uncovered short legs to hedge.');
  if (result.status === 'missing_marks') {
    notes.push('The held book has legs without IV, so book-wide risk could not be evaluated.');
  }
  if (result.cover != null) {
    notes.push(
      `The held book alone is unbounded or over budget, so two-part candidates start with the cheapest cover: ${result.cover.label}.`,
    );
  }
  if (result.status === 'ok' && result.candidates.length === 0 && result.nearestInfeasible.length > 0) {
    notes.push(
      `Nothing fits the $${args.maxTotalRiskUsd} budget. nearestInfeasible lists the closest candidates; shortfallUsd is the extra budget each needs.`,
    );
  }
  const allLegs = [...result.candidates, ...result.nearestInfeasible].flatMap((candidate) => candidate.legs);
  if (allLegs.some((leg) => leg.feeSource === 'default_estimate')) notes.push(DEFAULT_FEE_NOTE);
  notes.push(
    'Each leg is priced at the best executable quote across venues (buy at ask, sell at bid); sameVenue is false when legs sit on different venues, which do not share margin.',
    "candidatePnlUsd is the candidate's own P&L at the target; bookPnlUsd and worstLossUsd include the held book when portfolioRef is given. rewardToRisk = candidatePnlUsd ÷ the worst loss the candidate adds (book-wide worst loss when the held book alone is unbounded).",
    'Verify the chosen candidate with oggregator_evaluate_structure (same legs, sides, sizes and venues, plus portfolioRef) before recommending it.',
  );

  return {
    ok: true,
    data: {
      source: 'oggregator_structure_search',
      evaluatedAt: new Date(nowMs).toISOString(),
      status: result.status,
      underlying,
      view: args.view,
      maxTotalRiskUsd: args.maxTotalRiskUsd,
      spotUsd: cents(result.spotUsd),
      searched: {
        expiries,
        minDte: args.minDte,
        maxDte: args.maxDte,
        size: args.size,
        maxSpreadPct: args.maxSpreadPct,
        targetMovePct: args.targetMovePct ?? 'view default',
        targetHorizonDays: args.targetHorizonDays ?? "each candidate's first expiry",
        venues: args.venues ?? 'all',
      },
      heldBook:
        scope == null || result.heldBook == null
          ? { included: false, legCount: 0 }
          : {
              included: true,
              legCount: result.heldBook.legCount,
              portfolioGeneratedAt: new Date(scope.generatedAt).toISOString(),
              worstLossUsd: cents(result.heldBook.worstLossUsd),
              upsideUnbounded: result.heldBook.upsideUnbounded,
              unboundedAfter: result.heldBook.unboundedAfter,
              uncoveredShorts: result.heldBook.uncoveredShorts.map((short) => shortLabel(underlying, short)),
            },
      cover:
        result.cover == null
          ? null
          : {
              label: result.cover.label,
              netCostUsd: cents(result.cover.netCostUsd),
              bookWorstLossUsd: cents(result.cover.bookWorstLossUsd),
              headroomUsd: cents(result.cover.headroomUsd),
            },
      candidates: result.candidates.map(compactCandidate),
      nearestInfeasible: result.nearestInfeasible.map(compactCandidate),
      stats: result.stats,
      assumptions: result.assumptions,
      notes,
    },
  };
}
