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

export type HeldBookResolution =
  | { ok: true; held: HeldLegsWithMarks; scope: PortfolioRefScope | null }
  | { ok: false; error: string };

/** Resolves an optional portfolioRef server-side to the held legs on `underlying`. */
export async function resolveHeldBook(
  portfolio: StructureToolPortfolioAccess,
  portfolioRef: string | undefined,
  underlying: string,
  omitHint: string,
): Promise<HeldBookResolution> {
  if (portfolioRef == null) return { ok: true, held: [], scope: null };
  const resolved = portfolio.refs.resolve(portfolioRef);
  if (!resolved.ok) {
    return {
      ok: false,
      error:
        resolved.error === 'expired'
          ? `portfolioRef has expired (15 minute lifetime). Ask the user to send the question again for a fresh portfolio context, or omit portfolioRef to ${omitHint}.`
          : `portfolioRef is not recognised. Use the portfolioRef from the latest portfolio context, or omit it to ${omitHint}.`,
    };
  }
  const scope = resolved.scope;
  if (scope.underlying != null && scope.underlying.toUpperCase() !== underlying) {
    return { ok: false, error: `portfolioRef covers the ${scope.underlying} book, not ${underlying}.` };
  }
  const legs = await portfolio.resolveHeldLegs(scope);
  if (legs == null) return { ok: false, error: 'The held portfolio could not be loaded.' };
  return { ok: true, held: legs.filter(({ leg }) => leg.underlying === underlying), scope };
}
