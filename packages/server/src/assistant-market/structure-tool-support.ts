import type { EvaluateStructureInput, ProposedLegQuote, VenueId } from '@oggregator/core';
import { VENUE_IDS } from '@oggregator/protocol';

import type { ExecutableQuoteSet, VenueExecutableQuote } from './market-data-compaction.js';
import type { PortfolioRefScope, PortfolioRefStore } from './portfolio-ref.js';

export type HeldLegsWithMarks = EvaluateStructureInput['held'];

export interface StructureToolPortfolioAccess {
  refs: PortfolioRefStore;
  resolveHeldLegs: (scope: PortfolioRefScope) => Promise<HeldLegsWithMarks | null>;
}

export interface ResolvedQuote {
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

export interface QuoteRequest {
  strike: number;
  right: 'call' | 'put';
  side: 'buy' | 'sell';
  /** Restrict to these venues; omit for the best executable quote across venues. */
  venues?: readonly string[] | undefined;
}

export function cents(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function fraction(value: number | null | undefined): number | null {
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

export function isVenueId(value: string): value is VenueId {
  return (VENUE_IDS as readonly string[]).includes(value);
}

/**
 * Best executable quote for one side: lowest ask to buy, highest bid to sell. IV falls back
 * to the median venue mark IV for the strike when the chosen venue reports none.
 */
export function selectExecutableQuote(
  set: ExecutableQuoteSet,
  request: QuoteRequest,
): { ok: true; value: ResolvedQuote } | { ok: false; error: string } {
  const label = `${set.underlying} ${set.expiry} ${request.strike} ${request.right}`;
  const venueText = request.venues == null ? '' : request.venues.join(', ');
  const row = set.quotes.find((item) => item.strike === request.strike && item.right === request.right);
  if (row == null || row.venues.length === 0) {
    return { ok: false, error: `No fresh quote for ${label}. Check the strike with oggregator_option_chain.` };
  }
  const allowed = request.venues;
  const candidates =
    allowed == null ? row.venues : row.venues.filter((quote) => allowed.includes(quote.venue));
  if (candidates.length === 0) {
    return { ok: false, error: `No fresh ${venueText} quote for ${label}.` };
  }
  const priced = candidates.filter((quote) =>
    request.side === 'buy' ? (quote.askUsd ?? 0) > 0 : (quote.bidUsd ?? 0) > 0,
  );
  const best = priced.reduce<VenueExecutableQuote | null>((current, quote) => {
    if (current == null) return quote;
    return request.side === 'buy'
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
      error: `No executable ${request.side === 'buy' ? 'ask' : 'bid'} for ${label}${venueText ? ` on ${venueText}` : ''}.`,
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
        feePerContractUsd: request.side === 'buy' ? best.askTakerFeeUsd : best.bidTakerFeeUsd,
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

export type UnresolvedHeldBookReason = 'unknown_ref' | 'expired_ref' | 'underlying_mismatch' | 'load_failed';

export interface UnresolvedHeldBook {
  reason: UnresolvedHeldBookReason;
  message: string;
}

export interface HeldBookResolution {
  held: HeldLegsWithMarks;
  /** Null when no ref was passed or it did not resolve. */
  scope: PortfolioRefScope | null;
  unresolved: UnresolvedHeldBook | null;
}

const STANDALONE_HINT =
  'Every number in this result is for the proposed legs alone, not book-wide. Do not present it as total portfolio risk; take held-book risk from riskBudgetFacts, and if a fresh portfolioRef is needed, ask the user to resend the question. Do not retry with the same ref.';

/**
 * Resolves an optional portfolioRef server-side to the held legs on `underlying`. A ref that does
 * not resolve leaves the book empty and says why, so callers can still evaluate the proposed legs.
 */
export async function resolveHeldBook(
  portfolio: StructureToolPortfolioAccess,
  portfolioRef: string | undefined,
  underlying: string,
): Promise<HeldBookResolution> {
  const unresolved = (reason: UnresolvedHeldBookReason, message: string): HeldBookResolution => ({
    held: [],
    scope: null,
    unresolved: { reason, message },
  });
  if (portfolioRef == null) return { held: [], scope: null, unresolved: null };
  const resolved = portfolio.refs.resolve(portfolioRef);
  if (!resolved.ok) {
    return resolved.error === 'expired'
      ? unresolved('expired_ref', 'portfolioRef has expired.')
      : unresolved(
          'unknown_ref',
          'portfolioRef is not recognised: it is not from the latest portfolio context, or the server restarted.',
        );
  }
  const scope = resolved.scope;
  if (scope.underlying != null && scope.underlying.toUpperCase() !== underlying) {
    return unresolved('underlying_mismatch', `portfolioRef covers the ${scope.underlying} book, not ${underlying}.`);
  }
  const legs = await portfolio.resolveHeldLegs(scope);
  if (legs == null) return unresolved('load_failed', 'The held portfolio could not be loaded.');
  return { held: legs.filter(({ leg }) => leg.underlying === underlying), scope, unresolved: null };
}

export function heldBookSummary(book: HeldBookResolution, extra: Record<string, unknown> = {}) {
  if (book.unresolved != null) {
    return {
      included: false,
      status: 'unresolved' as const,
      reason: book.unresolved.reason,
      message: book.unresolved.message,
      legCount: 0,
      hint: STANDALONE_HINT,
    };
  }
  if (book.scope == null) return { included: false, status: 'not_requested' as const, legCount: 0 };
  return {
    included: true,
    status: 'included' as const,
    legCount: book.held.length,
    portfolioGeneratedAt: new Date(book.scope.generatedAt).toISOString(),
    ...extra,
  };
}

export function unresolvedBookNote(book: HeldBookResolution): string[] {
  return book.unresolved == null
    ? []
    : [`HELD BOOK NOT INCLUDED (${book.unresolved.message}) ${STANDALONE_HINT}`];
}
