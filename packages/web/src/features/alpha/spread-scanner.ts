import type { VenueId } from '@shared/enriched';
import {
  INVALID_INPUT_REASON,
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

// Thalex charges one combo fee for both legs.
const THALEX_RULES: PricingRules = {
  requireSameSettlement: true,
  combineFees: (buyFee, sellFee, quantity) =>
    Math.max(0.0001, buyFee * quantity, sellFee * quantity),
};
const DEFAULT_RULES: PricingRules = { requireSameSettlement: true, combineFees: sumTakerFees };

export function scanSpreads(input: SpreadScanInput): VenueScan[] {
  const ctx = scanContext(input);
  return input.venues.map((venue) => {
    const { rejected, reject } = rejectionCounter();
    const result: VenueScan = { venue, candidates: [], rejected };
    if (!ctx.valid) {
      reject(INVALID_INPUT_REASON);
      return result;
    }
    const rules = venue === 'thalex' ? THALEX_RULES : DEFAULT_RULES;
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
