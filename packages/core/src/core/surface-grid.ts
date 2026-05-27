import type { VenueId } from '../types/common.js';
import { getAdapter, getAllAdapters } from './registry.js';
import { buildComparisonChain } from './aggregator.js';
import {
  buildEnrichedChain,
  computeChainStats,
  computeDte,
  computeIvSurface,
  computeIvSurfaceFine,
  ULTRA_FINE_DELTA_GRID,
  type EnrichedStrike,
  type IvSurfaceRow,
  type IvSurfaceFineRow,
} from './enrichment.js';
import { smoothFineSurfaceRow } from './iv-surface-smoothing.js';
import type { ChainRequest, VenueOptionChain } from './types.js';

const DAYS_IN_YEAR = 365;
const SURFACE_GRID_EXPIRY_CONCURRENCY = 4;
const SURFACE_CACHE_TTL_MS = 15_000;

const surfaceCache = new Map<string, { ttl: number; entries: SurfaceGridEntry[] }>();

function surfaceCacheKey(underlying: string, venues: VenueId[], includeVenueSurfaces: boolean): string {
  return `${includeVenueSurfaces ? 'v' : 'c'}:${underlying}:${venues.slice().sort().join(',')}`;
}

export interface SurfaceGridEntry {
  expiry: string;
  dte: number;
  surfaceRow: IvSurfaceRow;
  surfaceFineRow: IvSurfaceFineRow;
  surfaceFineSmoothedRow: IvSurfaceFineRow;
  venueSurfaceFineRow: Partial<Record<VenueId, IvSurfaceFineRow>>;
  venueSurfaceFineSmoothedRow: Partial<Record<VenueId, IvSurfaceFineRow>>;
  atmStrike: EnrichedStrike | null;
  strikes: EnrichedStrike[];
  // Per-expiry basis as a percentage of spot. Surfaced here so consumers that
  // already iterate the grid (e.g. RegimeService for 30d-CMM basis) don't
  // need to re-call computeChainStats.
  basisPct: number | null;
}

export interface BuildSurfaceGridOptions {
  underlying: string;
  venues?: VenueId[];
  // Default false — per-venue surfaces add ~5× SVI fits per expiry. Only the
  // /api/surface route needs them; IvHistoryService and RegimeService consume
  // the cross-venue rows only and should leave this off.
  includeVenueSurfaces?: boolean;
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Builds an IV surface grid (one row per listed expiry) by fetching chains
 * from each requested venue and running shared enrichment.
 *
 * Extracted from the /api/surface route so the same code path feeds the
 * REST response and the IvHistoryService snapshot loop.
 */
export async function buildIvSurfaceGrid({
  underlying,
  venues,
  includeVenueSurfaces = false,
}: BuildSurfaceGridOptions): Promise<SurfaceGridEntry[]> {
  const requestedVenues: VenueId[] = venues ?? getAllAdapters().map((a) => a.venue);

  const key = surfaceCacheKey(underlying, requestedVenues, includeVenueSurfaces);
  const cached = surfaceCache.get(key);
  if (cached != null && Date.now() < cached.ttl) return cached.entries;

  const allExpiries = new Set<string>();
  const expiryLists = await Promise.allSettled(
    requestedVenues.map(async (venueId) => getAdapter(venueId).listExpiries(underlying)),
  );
  for (const result of expiryLists) {
    if (result.status !== 'fulfilled') continue;
    for (const expiry of result.value) {
      allExpiries.add(expiry);
    }
  }

  const sortedExpiries = [...allExpiries].sort();
  const entries = await mapConcurrent(
    sortedExpiries,
    SURFACE_GRID_EXPIRY_CONCURRENCY,
    async (expiry): Promise<SurfaceGridEntry | null> => {
      const request: ChainRequest = { underlying, expiry, venues: requestedVenues };

      const settled = await Promise.allSettled(
        requestedVenues.map((venueId) => getAdapter(venueId).fetchOptionChain(request)),
      );

      const chains: VenueOptionChain[] = settled
        .filter((r): r is PromiseFulfilledResult<VenueOptionChain> => r.status === 'fulfilled')
        .map((r) => r.value);

      if (chains.length === 0) return null;

      const comparison = buildComparisonChain(underlying, expiry, chains);
      const enriched = buildEnrichedChain(underlying, expiry, comparison.rows, chains);
      const stats = computeChainStats(enriched.strikes, chains);
      const refPrice = stats.indexPriceUsd ?? stats.forwardPriceUsd;
      const dte = computeDte(expiry);
      const surfaceRow = computeIvSurface(expiry, dte, enriched.strikes, refPrice);
      const surfaceFineRow = computeIvSurfaceFine(expiry, dte, enriched.strikes);
      const T = dte > 0 ? dte / DAYS_IN_YEAR : 0;
      const surfaceFineSmoothedRow = smoothFineSurfaceRow(
        surfaceFineRow,
        enriched.strikes,
        refPrice,
        T,
        ULTRA_FINE_DELTA_GRID,
      );

      const venueSurfaceFineRow: Partial<Record<VenueId, IvSurfaceFineRow>> = {};
      const venueSurfaceFineSmoothedRow: Partial<Record<VenueId, IvSurfaceFineRow>> = {};
      if (includeVenueSurfaces) {
        for (const v of requestedVenues) {
          const fine = computeIvSurfaceFine(expiry, dte, enriched.strikes, v);
          if (fine.ivs.every((iv) => iv == null)) continue;
          venueSurfaceFineRow[v] = fine;
          venueSurfaceFineSmoothedRow[v] = smoothFineSurfaceRow(
            fine,
            enriched.strikes,
            refPrice,
            T,
            ULTRA_FINE_DELTA_GRID,
            v,
          );
        }
      }

      let atmStrike: EnrichedStrike | null = null;
      if (refPrice != null && enriched.strikes.length > 0) {
        let bestDist = Infinity;
        for (const strike of enriched.strikes) {
          const dist = Math.abs(strike.strike - refPrice);
          if (dist < bestDist) {
            bestDist = dist;
            atmStrike = strike;
          }
        }
      }

      // Yield to the event loop so WebSocket ping/pong and other pending
      // I/O are not starved during long surface builds. Without this, 30
      // expiries × 9 SVI fits each can block the event loop for seconds.
      await new Promise<void>((r) => setImmediate(r));

      return {
        expiry,
        dte,
        surfaceRow,
        surfaceFineRow,
        surfaceFineSmoothedRow,
        venueSurfaceFineRow,
        venueSurfaceFineSmoothedRow,
        atmStrike,
        strikes: enriched.strikes,
        basisPct: stats.basisPct,
      };
    },
  );

  const filtered = entries.filter((entry): entry is SurfaceGridEntry => entry != null);

  surfaceCache.set(key, { ttl: Date.now() + SURFACE_CACHE_TTL_MS, entries: filtered });

  return filtered;
}
