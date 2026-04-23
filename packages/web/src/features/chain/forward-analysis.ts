import type { EnrichedSide, EnrichedStrike, VenueId } from '@shared/enriched';

export interface ForwardRow {
  venueId: VenueId;
  fImplied: number | null;
  delta: number | null;
}

export function computeImpliedForward(
  strike: number,
  callMid: number | null,
  putMid: number | null,
): number | null {
  if (callMid == null || putMid == null) return null;
  const f = strike + callMid - putMid;
  return Number.isFinite(f) ? f : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function venueForwardsAt(
  strikeRow: EnrichedStrike,
  activeVenues: readonly string[],
): Array<{ venueId: VenueId; f: number }> {
  const out: Array<{ venueId: VenueId; f: number }> = [];
  const callVenues = strikeRow.call.venues;
  const putVenues = strikeRow.put.venues;
  for (const venueId of Object.keys(callVenues) as VenueId[]) {
    if (!activeVenues.includes(venueId)) continue;
    const callMid = callVenues[venueId]?.mid ?? null;
    const putMid = putVenues[venueId]?.mid ?? null;
    const f = computeImpliedForward(strikeRow.strike, callMid, putMid);
    if (f != null) out.push({ venueId, f });
  }
  return out;
}

export function computeAtmConsensus(
  strikes: readonly EnrichedStrike[],
  atmStrike: number | null,
  activeVenues: readonly string[],
): number | null {
  if (atmStrike == null) return null;
  const row = strikes.find((s) => s.strike === atmStrike);
  if (!row) return null;
  const pairs = venueForwardsAt(row, activeVenues);
  if (pairs.length < 2) return null;
  return median(pairs.map((p) => p.f));
}

export function computeForwardRows(
  callSide: EnrichedSide,
  putSide: EnrichedSide,
  strike: number,
  activeVenues: readonly string[],
  consensus: number | null,
): ForwardRow[] {
  const rows: ForwardRow[] = [];
  const seen = new Set<VenueId>();
  const pushVenue = (venueId: VenueId) => {
    if (seen.has(venueId)) return;
    if (!activeVenues.includes(venueId)) return;
    seen.add(venueId);
    const callMid = callSide.venues[venueId]?.mid ?? null;
    const putMid = putSide.venues[venueId]?.mid ?? null;
    const fImplied = computeImpliedForward(strike, callMid, putMid);
    const delta = fImplied != null && consensus != null ? fImplied - consensus : null;
    rows.push({ venueId, fImplied, delta });
  };
  for (const v of Object.keys(callSide.venues) as VenueId[]) pushVenue(v);
  for (const v of Object.keys(putSide.venues) as VenueId[]) pushVenue(v);
  return rows;
}
