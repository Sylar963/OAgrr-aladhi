import type { VenueId } from '@shared/enriched';
import type { VenueScan } from './spread-scanner';
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
  type VerticalEconomics,
  venueLegs,
} from './vertical-pricing';

export interface CrossVenueCandidate extends RankedVertical {
  sellVenue: VenueId;
  buyVenue: VenueId;
  /** Net entry cash gained over the best same-venue pair; null when no same-venue pair exists. */
  improvement: number | null;
}
export interface CrossVenueScan {
  /** Cards group by the short leg's venue: it margins that leg as a naked short. */
  sellVenue: VenueId;
  candidates: CrossVenueCandidate[];
  rejected: Record<string, number>;
}

export const NOT_BETTER_REASON = 'Same-venue route is as good or better';
export const SINGLE_VENUE_REASON = 'Enable a second venue to route across venues';

// Legs fill as independent outright orders, so no combo discount and settlement may differ.
const CROSS_RULES: PricingRules = { requireSameSettlement: false, combineFees: sumTakerFees };

const netEntry = (c: VerticalEconomics) => c.grossPremium - c.entryFee;
const pairKey = (c: Pick<VerticalEconomics, 'kind' | 'buyStrike' | 'sellStrike'>) =>
  `${c.kind}:${c.buyStrike}:${c.sellStrike}`;

function bestSameVenueNet(scans: readonly VenueScan[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const scan of scans)
    for (const c of scan.candidates) {
      const key = pairKey(c);
      best.set(key, Math.max(best.get(key) ?? -Infinity, netEntry(c)));
    }
  return best;
}

export function scanCrossVenueSpreads(
  input: SpreadScanInput,
  sameVenueScans: readonly VenueScan[],
): CrossVenueScan[] {
  const ctx = scanContext(input);
  const bestSame = bestSameVenueNet(sameVenueScans);
  return input.venues.map((sellVenue) => {
    const { rejected, reject } = rejectionCounter();
    const result: CrossVenueScan = { sellVenue, candidates: [], rejected };
    if (!ctx.valid) {
      reject(INVALID_INPUT_REASON);
      return result;
    }
    const buyVenues = input.venues.filter((venue) => venue !== sellVenue);
    if (buyVenues.length === 0) {
      reject(SINGLE_VENUE_REASON);
      return result;
    }
    for (const right of ['call', 'put'] as const) {
      const sellLegs = venueLegs(input, sellVenue, right);
      for (const buyVenue of buyVenues)
        for (const buy of venueLegs(input, buyVenue, right))
          for (const sell of sellLegs) {
            if (buy.strike === sell.strike) continue;
            const economics = priceVertical(ctx, right, buy, sell, CROSS_RULES, reject);
            if (!economics) continue;
            const same = bestSame.get(pairKey(economics));
            if (same != null && netEntry(economics) <= same + 1e-9) {
              reject(NOT_BETTER_REASON);
              continue;
            }
            result.candidates.push({
              ...economics,
              id: `${sellVenue}>${buyVenue}:${economics.expiry}:${economics.kind}:${buy.strike}:${sell.strike}`,
              sellVenue,
              buyVenue,
              improvement: same == null ? null : netEntry(economics) - same,
            });
          }
    }
    if (result.candidates.length === 0 && Object.keys(rejected).length === 0)
      reject('No strikes quoted on this venue');
    rankCandidates(result.candidates);
    return result;
  });
}
