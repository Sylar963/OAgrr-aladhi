import { useQuery } from '@tanstack/react-query';

import { useExpiries } from '@features/chain';
import { VENUE_IDS } from '@lib/venue-meta';
import { fetchJson } from '@lib/http';
import type {
  EnrichedChainResponse,
  IvHistoryResponse,
  IvSurfaceResponse,
  IvTenor,
} from '@shared/enriched';

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

// Raw history is 5-minute samples; a 90d window at full resolution is ~16 MB.
const IV_HISTORY_RESOLUTION: Record<IvHistoryWindow, string> = { '30d': '15m', '90d': '1h' };

export function useIvHistory(underlying: string, window: IvHistoryWindow, tenor?: IvTenor) {
  const tenorParam = tenor ? `&tenor=${tenor}` : '';
  return useQuery({
    queryKey: ['iv-history', underlying, window, tenor ?? 'all'] as const,
    queryFn: () =>
      fetchJson<IvHistoryResponse>(
        `/iv-history?underlying=${underlying}&window=${window}&resolution=${IV_HISTORY_RESOLUTION[window]}${tenorParam}`,
      ),
    enabled: Boolean(underlying),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: IvHistoryResponse | undefined) => prev,
  });
}

export function useAllExpiriesSmile(underlying: string, enabled: boolean) {
  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];
  const venueParam = `&venues=${VENUE_IDS.join(',')}`;

  return useQuery({
    queryKey: ['smile-all', underlying, expiries.join(',')],
    queryFn: async (): Promise<EnrichedChainResponse[]> => {
      const results = await Promise.all(
        expiries.map((exp) =>
          fetchJson<EnrichedChainResponse>(
            `/chains?underlying=${underlying}&expiry=${exp}${venueParam}`,
          ),
        ),
      );
      return results;
    },
    enabled: Boolean(underlying && expiries.length > 0 && enabled),
    staleTime: 30_000,
    placeholderData: (prev: EnrichedChainResponse[] | undefined) => prev,
  });
}
