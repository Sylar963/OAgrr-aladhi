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

    if (quote.bid != null && quote.bid > 0 && (bestBid == null || quote.bid > bestBid)) {
      bestBid = quote.bid;
      bestBidVenue = venueId;
    }

    if (quote.ask != null && quote.ask > 0 && (bestAsk == null || quote.ask < bestAsk)) {
      bestAsk = quote.ask;
      bestAskVenue = venueId;
    }
  }

  return { bid: bestBid, ask: bestAsk, bidVenue: bestBidVenue, askVenue: bestAskVenue };
}

export function crossVenueSpreadPct(bba: BestBidAskResult): number | null {
  if (bba.bid == null || bba.ask == null || bba.bid <= 0 || bba.ask <= 0) {
    return null;
  }

  const mid = (bba.bid + bba.ask) / 2;
  return ((bba.ask - bba.bid) / mid) * 100;
}
