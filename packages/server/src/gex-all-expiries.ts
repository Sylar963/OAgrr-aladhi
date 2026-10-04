import {
  buildComparisonChain,
  buildEnrichedChain,
  combineGex,
  type GexStrike,
  getAdapter,
  getAllAdapters,
  VENUE_IDS,
  type VenueId,
  type VenueOptionChain,
} from '@oggregator/core';
import { bookLookup } from './dealer-book-lookup.js';
import { ResponseCache } from './response-cache.js';

const GEX_ALL_EXPIRIES_CACHE_TTL_MS = 10_000;
const gexAllExpiriesCache = new ResponseCache<AllExpiriesGex>(GEX_ALL_EXPIRIES_CACHE_TTL_MS, 64);

export interface AllExpiriesGex {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

export function parseGexVenues(venuesParam: string | undefined): VenueId[] {
  return venuesParam
    ? (venuesParam.split(',').filter((venue) => VENUE_IDS.includes(venue as VenueId)) as VenueId[])
    : getAllAdapters().map((adapter) => adapter.venue);
}

async function collectUnderlyingExpiries(underlying: string): Promise<string[]> {
  const lists = await Promise.all(getAllAdapters().map((a) => a.listExpiries(underlying)));
  const all = new Set<string>();
  for (const list of lists) {
    for (const expiry of list) all.add(expiry);
  }
  return Array.from(all).sort();
}

async function computeAllExpiriesGex(
  underlying: string,
  venues: VenueId[],
): Promise<AllExpiriesGex> {
  const expiries = await collectUnderlyingExpiries(underlying);
  if (expiries.length === 0) {
    return { underlying, expiries: [], spotPrice: null, gex: [] };
  }

  const snapshots = await Promise.all(
    expiries.map(async (expiry) => {
      const chains = (
        await Promise.all(
          venues.map(async (venue): Promise<VenueOptionChain | null> => {
            try {
              return await getAdapter(venue).fetchOptionChain({ underlying, expiry });
            } catch {
              return null;
            }
          }),
        )
      ).filter((chain): chain is VenueOptionChain => chain != null);
      const comparison = buildComparisonChain(underlying, expiry, chains);
      return buildEnrichedChain(underlying, expiry, comparison.rows, chains, bookLookup);
    }),
  );

  const aggregated = combineGex(snapshots.map((snap) => snap.gex));
  const first = snapshots[0];
  const spotPrice =
    first != null ? (first.stats.indexPriceUsd ?? first.stats.forwardPriceUsd) : null;

  return { underlying, expiries, spotPrice, gex: aggregated };
}

/** All-expiry, multi-venue GEX profile shared by `/gex-all-expiries` and the wall sampler. */
export function getAllExpiriesGex(
  underlying: string,
  venues: VenueId[] = parseGexVenues(undefined),
): Promise<AllExpiriesGex> {
  const cacheKey = `${underlying}:${venues.slice().sort().join(',')}`;
  return gexAllExpiriesCache.get(cacheKey, () => computeAllExpiriesGex(underlying, venues));
}
