import type { VenueId } from '../types/common.js';
import {
  computeIvSurface,
  interpTenor,
  type EnrichedSide,
  type EnrichedStrike,
  type IvSurfaceRow,
} from './enrichment.js';

export interface VenueTenorIvInput {
  expiry: string;
  dte: number;
  strikes: EnrichedStrike[];
  referencePriceUsd: number | null;
}

export interface VenueTenorIv {
  venue: VenueId;
  tenorDays: number;
  atmIv: number;
  rr25d: number | null;
  bfly25d: number | null;
}

type SurfaceField = 'atm' | 'delta25c' | 'delta25p';

function venueSide(side: EnrichedSide, venue: VenueId): EnrichedSide {
  const quote = side.venues[venue];
  return quote == null
    ? { venues: {}, bestIv: null, bestVenue: null }
    : { venues: { [venue]: quote }, bestIv: quote.markIv, bestVenue: venue };
}

function venueStrikes(strikes: EnrichedStrike[], venue: VenueId): EnrichedStrike[] {
  return strikes
    .filter((strike) => strike.call.venues[venue] != null || strike.put.venues[venue] != null)
    .map((strike) => ({
      strike: strike.strike,
      call: venueSide(strike.call, venue),
      put: venueSide(strike.put, venue),
    }));
}

// interpTenor holds the nearest expiry flat outside the listed range. For a single venue that
// would label a weekly-only venue's 5-day IV as its 30-day IV, so the tenor must be bracketed.
function bracketedTenor(rows: IvSurfaceRow[], tenorDays: number, field: SurfaceField): number | null {
  const dtes = rows.filter((row) => row[field] != null && row.dte > 0).map((row) => row.dte);
  if (dtes.length === 0) return null;
  if (tenorDays < Math.min(...dtes) || tenorDays > Math.max(...dtes)) return null;
  return interpTenor(rows, tenorDays, field);
}

/**
 * Constant-maturity ATM IV, 25Δ risk reversal and 25Δ butterfly per venue, built from that
 * venue's own quotes only. A tenor is omitted when the venue's expiries do not bracket it.
 */
export function computeVenueTenorIvs(
  entries: readonly VenueTenorIvInput[],
  tenorDays: readonly number[],
): VenueTenorIv[] {
  const venues = new Set<VenueId>();
  for (const entry of entries) {
    for (const strike of entry.strikes) {
      for (const venue of Object.keys(strike.call.venues) as VenueId[]) venues.add(venue);
      for (const venue of Object.keys(strike.put.venues) as VenueId[]) venues.add(venue);
    }
  }

  const results: VenueTenorIv[] = [];
  for (const venue of [...venues].sort()) {
    const rows = entries
      .map((entry) => {
        const strikes = venueStrikes(entry.strikes, venue);
        return strikes.length === 0
          ? null
          : computeIvSurface(entry.expiry, entry.dte, strikes, entry.referencePriceUsd);
      })
      .filter((row): row is IvSurfaceRow => row != null);

    for (const days of tenorDays) {
      const atmIv = bracketedTenor(rows, days, 'atm');
      if (atmIv == null) continue;
      const call25 = bracketedTenor(rows, days, 'delta25c');
      const put25 = bracketedTenor(rows, days, 'delta25p');
      results.push({
        venue,
        tenorDays: days,
        atmIv,
        rr25d: call25 != null && put25 != null ? call25 - put25 : null,
        bfly25d: call25 != null && put25 != null ? (call25 + put25) / 2 - atmIv : null,
      });
    }
  }
  return results;
}
