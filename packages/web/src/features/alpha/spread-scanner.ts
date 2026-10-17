import type { EnrichedChainResponse, VenueId } from '@shared/enriched';
import {
  INVALID_INPUT_REASON,
  LIVE_QUOTE_LIMITS,
  type PricingRules,
  priceVertical,
  type RankedVertical,
  rankCandidates,
  rejectionCounter,
  type SpreadScanInput,
  scanContext,
  sumTakerFees,
  venueLegs,
} from './vertical-pricing';

export interface SpreadCandidate extends RankedVertical {
  venue: VenueId;
}
export interface VenueScan {
  venue: VenueId;
  candidates: SpreadCandidate[];
  rejected: Record<string, number>;
  /** The venue publishes marks for this chain but no bid or ask on any option. */
  markOnly: boolean;
}

const DEFAULT_RULES: PricingRules = {
  requireSameSettlement: true,
  allowInverse: true,
  combineFees: sumTakerFees,
  ...LIVE_QUOTE_LIMITS,
};
const VENUE_RULES: Partial<Record<string, PricingRules>> = {
  // Thalex charges one combo fee for both legs.
  thalex: {
    ...DEFAULT_RULES,
    combineFees: (buyFee, sellFee, quantity) =>
      Math.max(0.0001, buyFee * quantity, sellFee * quantity),
  },
  // 15-min delayed feed: asOfMs is when the delayed quote reached us, so these bound
  // feed liveness (the service's 90s staleness window), not executability.
  tastytrade: { ...DEFAULT_RULES, maxQuoteAgeMs: 90_000, maxLegSkewMs: 90_000 },
};

export function scanSpreads(input: SpreadScanInput): VenueScan[] {
  const ctx = scanContext(input);
  return input.venues.map((venue) => {
    const { rejected, reject } = rejectionCounter();
    const result: VenueScan = {
      venue,
      candidates: [],
      rejected,
      markOnly: isMarkOnly(input.chain, venue),
    };
    if (!ctx.valid) {
      reject(INVALID_INPUT_REASON);
      return result;
    }
    const rules = VENUE_RULES[venue] ?? DEFAULT_RULES;
    for (const right of ['call', 'put'] as const) {
      const legs = venueLegs(input, venue, right);
      for (const buy of legs)
        for (const sell of legs) {
          if (buy.strike === sell.strike) continue;
          const economics = priceVertical(ctx, right, buy, sell, rules, reject);
          if (!economics) continue;
          result.candidates.push({
            ...economics,
            id: `${venue}:${economics.expiry}:${economics.kind}:${buy.strike}:${sell.strike}`,
            venue,
          });
        }
    }
    if (result.candidates.length === 0 && Object.keys(rejected).length === 0)
      reject('No two strikes available on this venue');
    rankCandidates(result.candidates);
    return result;
  });
}

/** Marks but no executable side anywhere on the chain: an empty book (Paradex NEAR, META, XAU). */
export function isMarkOnly(chain: EnrichedChainResponse, venue: VenueId): boolean {
  let marked = false;
  for (const row of chain.strikes) {
    for (const side of [row.call, row.put]) {
      const execution = side?.venues[venue]?.execution;
      if (!execution) continue;
      if ((execution.bidUsd ?? 0) > 0 || (execution.askUsd ?? 0) > 0) return false;
      if ((execution.markUsd ?? 0) > 0) marked = true;
    }
  }
  return marked;
}

export interface MarkIndicative {
  grossPremium: number;
  maxProfit: number;
  maxLoss: number;
}

/**
 * The selected vertical valued at venue marks, before fees. Only for display on a mark-only
 * venue: no order rests at these prices, so it is a reference value, never an entry price.
 */
export function indicativeAtMark(
  chain: EnrichedChainResponse,
  venue: VenueId,
  right: 'call' | 'put',
  sellStrike: number,
  buyStrike: number,
  quantity: number,
): MarkIndicative | null {
  const mark = (strike: number) =>
    chain.strikes.find((row) => row.strike === strike)?.[right]?.venues[venue]?.execution?.markUsd;
  const sellMark = mark(sellStrike);
  const buyMark = mark(buyStrike);
  if (sellMark == null || buyMark == null || !(quantity > 0)) return null;
  const grossPremium = (sellMark - buyMark) * quantity;
  const width = Math.abs(sellStrike - buyStrike) * quantity;
  return grossPremium >= 0
    ? { grossPremium, maxProfit: grossPremium, maxLoss: width - grossPremium }
    : { grossPremium, maxProfit: width + grossPremium, maxLoss: -grossPremium };
}
