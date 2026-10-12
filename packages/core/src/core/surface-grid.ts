import type { VenueId } from '../types/common.js';
import { getAdapter, getAllAdapters } from './registry.js';
import { buildComparisonChain } from './aggregator.js';
import {
  buildEnrichedChain,
  computeChainStats,
  computeDte,
  computeIvSurface,
  computeIvSurfaceFine,
  computeTermStructure,
  FINE_DELTA_GRID,
  ULTRA_FINE_DELTA_GRID,
  type EnrichedStrike,
  type IvSurfaceRow,
  type IvSurfaceFineRow,
  type TermStructure,
} from './enrichment.js';
import {
  computeCmmIvSurface,
  DENSE_CMM_TENORS,
  smoothFineSurfaceRow,
  type CmmIvSurfaceRow,
} from './iv-surface-smoothing.js';
import type { ChainRequest, VenueOptionChain } from './types.js';

const DAYS_IN_YEAR = 365;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

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
  referencePriceUsd: number | null;
}

export interface BuildSurfaceGridOptions {
  underlying: string;
  venues?: VenueId[];
  // Default false — per-venue surfaces add ~5× SVI fits per expiry. Only the
  // /api/surface route needs them; IvHistoryService and RegimeService consume
  // the cross-venue rows only and should leave this off.
  includeVenueSurfaces?: boolean;
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

  const allExpiries = new Set<string>();
  for (const venueId of requestedVenues) {
    try {
      const adapter = getAdapter(venueId);
      const expiries = await adapter.listExpiries(underlying);
      for (const e of expiries) allExpiries.add(e);
    } catch {
      // Not every venue lists every underlying.
    }
  }

  const sortedExpiries = [...allExpiries].sort();
  const entries: SurfaceGridEntry[] = [];

  for (const expiry of sortedExpiries) {
    // Chain fetches usually resolve synchronously from cached quotes, so without an explicit
    // yield the whole grid (SVI fits per expiry) ran as one ~4 s block every snapshot.
    await yieldToEventLoop();
    const request: ChainRequest = { underlying, expiry, venues: requestedVenues };

    const settled = await Promise.allSettled(
      requestedVenues.map((venueId) => getAdapter(venueId).fetchOptionChain(request)),
    );

    const chains: VenueOptionChain[] = settled
      .filter((r): r is PromiseFulfilledResult<VenueOptionChain> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (chains.length === 0) continue;

    entries.push(
      buildSurfaceGridEntry(underlying, expiry, chains, {
        venues: requestedVenues,
        includeVenueSurfaces,
      }),
    );
  }

  return entries;
}

export interface SurfaceGridEntryOptions {
  venues: readonly VenueId[];
  includeVenueSurfaces?: boolean;
  /** Exact expiry; without it DTE uses the 08:00 UTC crypto convention. */
  expiryTs?: number | null;
}

/** One surface-grid row from already-fetched venue chains for a single expiry. */
export function buildSurfaceGridEntry(
  underlying: string,
  expiry: string,
  chains: VenueOptionChain[],
  { venues, includeVenueSurfaces = false, expiryTs = null }: SurfaceGridEntryOptions,
): SurfaceGridEntry {
  const comparison = buildComparisonChain(underlying, expiry, chains);
  const enriched = buildEnrichedChain(underlying, expiry, comparison.rows, chains);
  const stats = computeChainStats(enriched.strikes, chains);
  const refPrice = stats.indexPriceUsd ?? stats.forwardPriceUsd;
  const dte = computeDte(expiry, expiryTs);
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
    for (const v of venues) {
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
    for (const s of enriched.strikes) {
      const dist = Math.abs(s.strike - refPrice);
      if (dist < bestDist) {
        bestDist = dist;
        atmStrike = s;
      }
    }
  }

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
    referencePriceUsd: refPrice,
  };
}

export interface SurfaceAnalytics {
  underlying: string;
  surface: IvSurfaceRow[];
  surfaceFine: IvSurfaceFineRow[];
  surfaceFineSmoothed: IvSurfaceFineRow[];
  surfaceFineCmm: CmmIvSurfaceRow[];
  surfaceFineDeltas: readonly number[];
  surfaceFineDeltasDense: readonly number[];
  termStructure: TermStructure;
  venueAtm: Record<string, Array<{ expiry: string; dte: number; atm: number | null }>>;
  venueSurfaceFine: Partial<Record<VenueId, IvSurfaceFineRow[]>>;
  venueSurfaceFineSmoothed: Partial<Record<VenueId, IvSurfaceFineRow[]>>;
  venueSurfaceFineCmm: Partial<Record<VenueId, CmmIvSurfaceRow[]>>;
}

/** Cross-venue and per-venue surface views, term structure and constant-maturity grid. */
export function buildSurfaceAnalytics(
  underlying: string,
  entries: readonly SurfaceGridEntry[],
  venues: readonly VenueId[],
): SurfaceAnalytics {
  const venueAtm: SurfaceAnalytics['venueAtm'] = {};
  const venueSurfaceFine: SurfaceAnalytics['venueSurfaceFine'] = {};
  const venueSurfaceFineSmoothed: SurfaceAnalytics['venueSurfaceFineSmoothed'] = {};
  for (const venueId of venues) venueAtm[venueId] = [];

  for (const entry of entries) {
    for (const venueId of venues) {
      const callIv = entry.atmStrike?.call.venues[venueId]?.markIv ?? null;
      const putIv = entry.atmStrike?.put.venues[venueId]?.markIv ?? null;
      const iv = callIv != null && putIv != null ? (callIv + putIv) / 2 : (callIv ?? putIv);
      venueAtm[venueId]!.push({ expiry: entry.expiry, dte: entry.dte, atm: iv });

      const fine = entry.venueSurfaceFineRow[venueId];
      const smoothed = entry.venueSurfaceFineSmoothedRow[venueId];
      if (fine) (venueSurfaceFine[venueId] ??= []).push(fine);
      if (smoothed) (venueSurfaceFineSmoothed[venueId] ??= []).push(smoothed);
    }
  }

  const surface = entries.map((e) => e.surfaceRow);
  const surfaceFineSmoothed = entries.map((e) => e.surfaceFineSmoothedRow);
  const venueSurfaceFineCmm: SurfaceAnalytics['venueSurfaceFineCmm'] = {};
  for (const venueId of venues) {
    const rows = venueSurfaceFineSmoothed[venueId];
    if (!rows || rows.length === 0) continue;
    const cmm = computeCmmIvSurface(rows, DENSE_CMM_TENORS);
    if (cmm.length > 0) venueSurfaceFineCmm[venueId] = cmm;
  }

  return {
    underlying,
    surface,
    surfaceFine: entries.map((e) => e.surfaceFineRow),
    surfaceFineSmoothed,
    surfaceFineCmm: computeCmmIvSurface(surfaceFineSmoothed, DENSE_CMM_TENORS),
    surfaceFineDeltas: FINE_DELTA_GRID,
    surfaceFineDeltasDense: ULTRA_FINE_DELTA_GRID,
    termStructure: computeTermStructure(surface),
    venueAtm,
    venueSurfaceFine,
    venueSurfaceFineSmoothed,
    venueSurfaceFineCmm,
  };
}
