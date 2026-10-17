import { getAllAdapters, type VenueId } from '@oggregator/core';

function toPublicUnderlying(underlying: string, venueUnderlyings: readonly string[]): string {
  const [base, settle] = underlying.split('_');
  if (!base || !settle) return underlying;
  return venueUnderlyings.includes(base) ? underlying : base;
}

export interface VenuePublicUnderlyings {
  venue: VenueId;
  underlyings: string[];
}

/** Underlyings as the UI names them: a venue's `SOL_USDC` is `SOL` unless it also lists plain `SOL`. */
export async function listPublicUnderlyingsByVenue(): Promise<VenuePublicUnderlyings[]> {
  const settled = await Promise.allSettled(
    getAllAdapters().map(async (adapter) => {
      const canonical = await adapter.listUnderlyings();
      return {
        venue: adapter.venue,
        underlyings: [...new Set(canonical.map((u) => toPublicUnderlying(u, canonical)))].sort(),
      };
    }),
  );
  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

export async function listPublicUnderlyings(): Promise<string[]> {
  const all = new Set<string>();
  for (const venue of await listPublicUnderlyingsByVenue()) {
    for (const underlying of venue.underlyings) all.add(underlying);
  }
  return [...all].sort();
}
