import type {
  EnrichedSideDiff,
  EnrichedStrikeDiff,
  VenueQuoteDiff,
} from '@oggregator/protocol';
import type { EnrichedChainResponse } from '../../core/enrichment.js';

type EnrichedStrike = EnrichedChainResponse['strikes'][number];
type EnrichedSide = EnrichedStrike['call'];
type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasRemovedKey(prev: PlainRecord, next: PlainRecord): boolean {
  for (const key of Object.keys(prev)) {
    if (prev[key] !== undefined && next[key] === undefined) return true;
  }
  return false;
}

// Returns the changed top-level keys, diffing one level into nested records (fees, execution).
// `null` means "send the whole quote with replace: true": a merge cannot express a removed key.
function diffQuote(prev: PlainRecord, next: PlainRecord): PlainRecord | null | undefined {
  if (hasRemovedKey(prev, next)) return null;

  let out: PlainRecord | undefined;
  for (const key of Object.keys(next)) {
    const before = prev[key];
    const after = next[key];
    if (before === after) continue;

    if (isPlainRecord(before) && isPlainRecord(after)) {
      if (hasRemovedKey(before, after)) return null;
      let nested: PlainRecord | undefined;
      for (const nestedKey of Object.keys(after)) {
        if (before[nestedKey] !== after[nestedKey]) (nested ??= {})[nestedKey] = after[nestedKey];
      }
      if (nested != null) (out ??= {})[key] = nested;
      continue;
    }
    (out ??= {})[key] = after;
  }
  return out;
}

function diffSide(prev: EnrichedSide | undefined, next: EnrichedSide): EnrichedSideDiff | null {
  const out: EnrichedSideDiff = {};
  let changed = false;

  if (prev == null || prev.bestIv !== next.bestIv) {
    out.bestIv = next.bestIv;
    changed = true;
  }
  if (prev == null || prev.bestVenue !== next.bestVenue) {
    out.bestVenue = next.bestVenue;
    changed = true;
  }

  let venues: Record<string, VenueQuoteDiff | null> | undefined;
  const prevVenues = (prev?.venues ?? {}) as Record<string, PlainRecord | undefined>;
  const nextVenues = next.venues as Record<string, PlainRecord | undefined>;

  for (const [venue, quote] of Object.entries(nextVenues)) {
    if (quote == null) continue;
    const before = prevVenues[venue];
    if (before === quote) continue;
    const diff = before == null ? null : diffQuote(before, quote);
    if (diff === undefined) continue;
    (venues ??= {})[venue] = (diff ?? { ...quote, replace: true }) as VenueQuoteDiff;
  }
  for (const venue of Object.keys(prevVenues)) {
    if (prevVenues[venue] != null && nextVenues[venue] == null) (venues ??= {})[venue] = null;
  }

  if (venues != null) {
    out.venues = venues;
    changed = true;
  }
  return changed ? out : null;
}

/** Field-level change from `prev` to `next`, or null when nothing a client renders changed. */
export function diffEnrichedStrike(
  prev: EnrichedStrike | undefined,
  next: EnrichedStrike,
): EnrichedStrikeDiff | null {
  const call = diffSide(prev?.call, next.call);
  const put = diffSide(prev?.put, next.put);
  if (call == null && put == null) return null;

  const out: EnrichedStrikeDiff = { strike: next.strike };
  if (call != null) out.call = call;
  if (put != null) out.put = put;
  return out;
}

export function diffEnrichedStrikes(
  previous: readonly EnrichedStrike[] | undefined,
  changed: readonly EnrichedStrike[],
): EnrichedStrikeDiff[] {
  const prevByStrike = new Map<number, EnrichedStrike>();
  for (const strike of previous ?? []) prevByStrike.set(strike.strike, strike);

  const out: EnrichedStrikeDiff[] = [];
  for (const strike of changed) {
    const diff = diffEnrichedStrike(prevByStrike.get(strike.strike), strike);
    if (diff != null) out.push(diff);
  }
  return out;
}
