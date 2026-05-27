import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import type { EnrichedChainResponse, IvHistoryResponse, IvSurfaceResponse } from '@shared/enriched';

export type IvHistoryWindow = '30d' | '90d';

export const surfaceKeys = {
  surface: (underlying: string, venues: string[]) =>
    ['surface', underlying, venues.slice().sort().join(',')] as const,
};

export function useSurface(underlying: string, venues: string[]) {
  const venueParam = venues.length > 0 ? `&venues=${venues.join(',')}` : '';
  return useQuery({
    queryKey: surfaceKeys.surface(underlying, venues),
    queryFn: () => fetchJson<IvSurfaceResponse>(`/surface?underlying=${underlying}${venueParam}`),
    enabled: Boolean(underlying),
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: (prev: IvSurfaceResponse | undefined) => prev,
  });
}

export function useIvHistory(underlying: string, window: IvHistoryWindow) {
  return useQuery({
    queryKey: ['iv-history', underlying, window] as const,
    queryFn: () =>
      fetchJson<IvHistoryResponse>(`/iv-history?underlying=${underlying}&window=${window}`),
    enabled: Boolean(underlying),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: IvHistoryResponse | undefined) => prev,
  });
}

/**
 * Returns per-expiry chain data for the smile chart, derived from the
 * surface response's per-strike data. This eliminates the 30+ parallel
 * /api/chains requests that previously caused WS subscription storms and
 * event-loop blocking from concurrent ChainRuntime acquisition.
 */
export function useAllExpiriesSmile(
  underlying: string,
): { data: EnrichedChainResponse[] | undefined; isPending: boolean } {
  const { data: surfaceData, isLoading } = useSurface(underlying, []);

  const chains = useMemo<EnrichedChainResponse[] | undefined>(() => {
    if (!surfaceData?.strikes || !surfaceData.surfaceFine) return undefined;
    return surfaceData.surfaceFine.map((row, i) => {
      const expiryStrikes = surfaceData.strikes?.[i];
      return {
        underlying,
        expiry: row.expiry,
        dte: row.dte,
        expiryTs: null,
        stats: {
          forwardPriceUsd: null,
          indexPriceUsd: null,
          basisPct: null,
          atmStrike: null,
          atmIv: null,
          putCallOiRatio: null,
          totalOiUsd: null,
          skew25d: null,
          bfly25d: null,
        },
        strikes: expiryStrikes ?? [],
        gex: [],
      } satisfies EnrichedChainResponse;
    });
  }, [surfaceData, underlying]);

  return { data: chains, isPending: isLoading };
}
