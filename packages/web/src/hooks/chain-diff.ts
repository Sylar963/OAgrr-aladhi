import type {
  EnrichedSideDiff,
  EnrichedStrikeDiff,
  VenueQuoteDiff,
} from '@oggregator/protocol';

import type { EnrichedSide, EnrichedStrike, VenueQuote } from '@shared/enriched';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function applyQuoteDiff(prev: VenueQuote | undefined, diff: VenueQuoteDiff): VenueQuote {
  const { replace, ...fields } = diff;
  if (replace === true || prev == null) return fields as VenueQuote;

  const next: Record<string, unknown> = { ...prev };
  for (const [key, value] of Object.entries(fields)) {
    const before = next[key];
    // Nested records (fees, execution) carry only their changed keys.
    next[key] = isPlainRecord(value) && isPlainRecord(before) ? { ...before, ...value } : value;
  }
  return next as unknown as VenueQuote;
}

function applySideDiff(prev: EnrichedSide, diff: EnrichedSideDiff): EnrichedSide {
  let venues = prev.venues;
  if (diff.venues != null) {
    const nextVenues: Record<string, VenueQuote | undefined> = { ...prev.venues };
    for (const [venue, quoteDiff] of Object.entries(diff.venues)) {
      if (quoteDiff == null) delete nextVenues[venue];
      else nextVenues[venue] = applyQuoteDiff(nextVenues[venue], quoteDiff);
    }
    venues = nextVenues as EnrichedSide['venues'];
  }
  return {
    venues,
    bestIv: diff.bestIv !== undefined ? diff.bestIv : prev.bestIv,
    bestVenue: diff.bestVenue !== undefined ? diff.bestVenue : prev.bestVenue,
  };
}

const EMPTY_SIDE: EnrichedSide = { venues: {}, bestIv: null, bestVenue: null };

/**
 * Apply field-level strike diffs. Strikes without a diff keep their object identity, and a
 * strike only gets a new object for the side that changed, so memoized rows skip re-rendering.
 */
export function applyStrikeDiffs(
  existing: EnrichedStrike[],
  diffs: readonly EnrichedStrikeDiff[],
): EnrichedStrike[] {
  if (diffs.length === 0) return existing;

  const byStrike = new Map<number, EnrichedStrike>();
  for (const strike of existing) byStrike.set(strike.strike, strike);

  let added = false;
  for (const diff of diffs) {
    const prev = byStrike.get(diff.strike);
    if (prev == null) added = true;
    const base: EnrichedStrike = prev ?? { strike: diff.strike, call: EMPTY_SIDE, put: EMPTY_SIDE };
    byStrike.set(diff.strike, {
      ...base,
      call: diff.call != null ? applySideDiff(base.call, diff.call) : base.call,
      put: diff.put != null ? applySideDiff(base.put, diff.put) : base.put,
    });
  }

  const merged = existing.map((strike) => byStrike.get(strike.strike)!);
  if (!added) return merged;
  return [...byStrike.values()].sort((left, right) => left.strike - right.strike);
}
