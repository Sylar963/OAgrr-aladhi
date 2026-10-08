import type { VenueId } from '@shared/enriched';
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
    const result: VenueScan = { venue, candidates: [], rejected };
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
