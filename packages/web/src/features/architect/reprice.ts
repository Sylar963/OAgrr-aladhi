import type { EnrichedChainResponse } from '@shared/enriched';
import type { Leg } from './payoff';

interface VenueQuote {
  ask: number | null;
  bid: number | null;
  mid: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  markIv: number | null;
}

function pickDirectionalPrice(
  quote: VenueQuote,
  direction: Leg['direction'],
): number | null {
  const topOfBook = direction === 'buy' ? quote.ask : quote.bid;
  if (topOfBook != null && topOfBook > 0) return topOfBook;
  if (quote.mid != null && quote.mid > 0) return quote.mid;
  return null;
}

type RepriceInput = Pick<Leg, 'type' | 'direction' | 'strike' | 'expiry' | 'quantity'>;

interface RepriceOptions {
  exactStrike?: boolean;
}

function nearestStrike(strikes: number[], target: number): number | null {
  if (strikes.length === 0) return null;

  return strikes.reduce((best, strike) =>
    Math.abs(strike - target) < Math.abs(best - target) ? strike : best,
  );
}

interface PickedQuote {
  strike: number;
  venue: string;
  quote: VenueQuote;
  price: number;
}

function pickBestQuote(
  chain: EnrichedChainResponse,
  activeVenues: readonly string[],
  leg: RepriceInput,
  options: RepriceOptions,
): PickedQuote | null {
  const availableStrikes = chain.strikes.map((entry) => entry.strike);
  const strike = options.exactStrike ? leg.strike : nearestStrike(availableStrikes, leg.strike);

  if (strike == null) return null;

  const strikeRow = chain.strikes.find((entry) => entry.strike === strike);
  if (!strikeRow) return null;

  const side = leg.type === 'call' ? strikeRow.call : strikeRow.put;
  let best: PickedQuote | null = null;

  for (const [venueId, quote] of Object.entries(side.venues)) {
    if (!quote || !activeVenues.includes(venueId)) continue;

    const price = pickDirectionalPrice(quote, leg.direction);
    if (price == null) continue;

    if (
      best == null ||
      (leg.direction === 'buy' && price < best.price) ||
      (leg.direction === 'sell' && price > best.price)
    ) {
      best = { strike, venue: venueId, quote, price };
    }
  }

  return best;
}

export function repriceLeg(
  chain: EnrichedChainResponse,
  activeVenues: string[],
  leg: RepriceInput,
  options: RepriceOptions = {},
): Omit<Leg, 'id'> | null {
  const picked = pickBestQuote(chain, activeVenues, leg, options);
  if (!picked) return null;

  return {
    ...leg,
    strike: picked.strike,
    entryPrice: picked.price,
    venue: picked.venue,
    delta: picked.quote.delta,
    gamma: picked.quote.gamma,
    theta: picked.quote.theta,
    vega: picked.quote.vega,
    iv: picked.quote.markIv,
  };
}

export interface OpeningCost {
  /** Net premium opening now, buys lifting the ask and sells hitting the bid. Positive = credit. */
  netPremiumAtMarket: number;
  /** Net premium if every leg filled at its venue's mid. Positive = credit. */
  netPremiumAtMid: number;
  /** Premium given up to the bid/ask spread versus mid. Always >= 0. */
  spreadCost: number;
  /** Legs whose venue had no quote on the crossing side, so they were priced at mid. */
  midFallbackLegs: number;
  /** Legs with no quote on any routed venue; excluded from the totals. */
  unquotedLegs: number;
}

/**
 * What opening the structure costs right now on the routed venues. Each leg is
 * priced on the venue `repriceLeg` would route it to, at its exact strike.
 */
export function openingCost(
  legs: readonly Leg[],
  chainFor: (expiry: string) => EnrichedChainResponse | null,
  activeVenues: readonly string[],
): OpeningCost {
  let netPremiumAtMarket = 0;
  let netPremiumAtMid = 0;
  let midFallbackLegs = 0;
  let unquotedLegs = 0;

  for (const leg of legs) {
    const chain = chainFor(leg.expiry);
    const picked = chain ? pickBestQuote(chain, activeVenues, leg, { exactStrike: true }) : null;
    if (!picked) {
      unquotedLegs += 1;
      continue;
    }

    const { quote, price } = picked;
    const crossing = leg.direction === 'buy' ? quote.ask : quote.bid;
    if (crossing == null || crossing <= 0) midFallbackLegs += 1;
    const mid = quote.mid != null && quote.mid > 0 ? quote.mid : price;

    const signedSize = (leg.direction === 'buy' ? -1 : 1) * leg.quantity * (leg.contractMultiplier ?? 1);
    netPremiumAtMarket += signedSize * price;
    netPremiumAtMid += signedSize * mid;
  }

  return {
    netPremiumAtMarket,
    netPremiumAtMid,
    spreadCost: Math.max(0, netPremiumAtMid - netPremiumAtMarket),
    midFallbackLegs,
    unquotedLegs,
  };
}
