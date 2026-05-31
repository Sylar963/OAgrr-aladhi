import type { EnrichedSide, VenueQuote } from '@shared/enriched';

const ACTIONABLE_QUOTE_MAX_AGE_MS = 60_000;

export interface BestBidAskResult {
  bid: number | null;
  ask: number | null;
  bidVenue: string | null;
  askVenue: string | null;
}

export function isActionableQuote(quote: VenueQuote, now = Date.now()): boolean {
  if (quote.asOfMs == null) return true;
  if (quote.asOfMs <= 0) return false;
  return now - quote.asOfMs <= ACTIONABLE_QUOTE_MAX_AGE_MS;
}

export function bestBidAsk(
  side: EnrichedSide,
  activeSet: ReadonlySet<string>,
  now = Date.now(),
): BestBidAskResult {
  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  let bestBidVenue: string | null = null;
  let bestAskVenue: string | null = null;

  for (const [venueId, quote] of Object.entries(side.venues)) {
    if (!activeSet.has(venueId) || !quote || !isActionableQuote(quote, now)) continue;

    if (quote.bid != null && (bestBid == null || quote.bid > bestBid)) {
      bestBid = quote.bid;
      bestBidVenue = venueId;
    }

    if (quote.ask != null && (bestAsk == null || quote.ask < bestAsk)) {
      bestAsk = quote.ask;
      bestAskVenue = venueId;
    }
  }

  return { bid: bestBid, ask: bestAsk, bidVenue: bestBidVenue, askVenue: bestAskVenue };
}
