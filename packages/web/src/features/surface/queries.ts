import {
  type CallPutFlowResponse,
  CallPutFlowResponseSchema,
  type TradfiVolHistoryResponse,
  TradfiVolHistoryResponseSchema,
} from '@oggregator/protocol';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { useExpiries } from '@features/chain';
import { VENUE_IDS } from '@lib/venue-meta';
import { fetchJson } from '@lib/http';
import { tradfiFetchJson } from '@lib/tradfi-http';
import type {
  EnrichedChainResponse,
  IvHistoryResponse,
  IvSurfaceResponse,
  IvTenor,
} from '@shared/enriched';
import type { SurfaceMarket } from './surface-market';

export type IvHistoryWindow = '30d' | '90d';

export const surfaceKeys = {
  surface: (underlying: string, venues: string[]) =>
    ['surface', underlying, venues.slice().sort().join(',')] as const,
};

function isWarming(data: IvSurfaceResponse | undefined): boolean {
  return data?.smiles != null && data.smiles.some((smile) => smile.strikes.length === 0);
}

export function useSurface(underlying: string, venues: string[], market: SurfaceMarket = 'crypto') {
  const venueParam = venues.length > 0 ? `&venues=${venues.join(',')}` : '';
  const tradfi = market === 'tradfi';
  return useQuery({
    queryKey: tradfi ? ['tradfi-surface', underlying] : surfaceKeys.surface(underlying, venues),
    queryFn: () =>
      tradfi
        ? tradfiFetchJson<IvSurfaceResponse>(`/surface?underlying=${encodeURIComponent(underlying)}`)
        : fetchJson<IvSurfaceResponse>(`/surface?underlying=${underlying}${venueParam}`),
    enabled: Boolean(underlying),
    staleTime: 4_000,
    // Freshly subscribed TradFi chains fill in within seconds; poll fast until they have.
    refetchInterval: (query) => (tradfi && isWarming(query.state.data) ? 1_000 : 5_000),
    // Keep the old surface only while refreshing the same ticker; across tickers it is wrong data.
    placeholderData: (prev: IvSurfaceResponse | undefined) =>
      prev?.underlying === underlying ? prev : undefined,
  });
}

// Raw history is 5-minute samples; a 90d window at full resolution is ~16 MB.
const IV_HISTORY_RESOLUTION: Record<IvHistoryWindow, string> = { '30d': '15m', '90d': '1h' };

export function useIvHistory(
  underlying: string,
  window: IvHistoryWindow,
  tenor?: IvTenor,
  enabled = true,
  market: SurfaceMarket = 'crypto',
) {
  const tenorParam = tenor ? `&tenor=${tenor}` : '';
  const path = `/iv-history?underlying=${encodeURIComponent(underlying)}&window=${window}&resolution=${IV_HISTORY_RESOLUTION[window]}${tenorParam}`;
  return useQuery({
    queryKey: [market === 'tradfi' ? 'tradfi-iv-history' : 'iv-history', underlying, window, tenor ?? 'all'] as const,
    queryFn: () =>
      market === 'tradfi' ? tradfiFetchJson<IvHistoryResponse>(path) : fetchJson<IvHistoryResponse>(path),
    enabled: enabled && Boolean(underlying),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: IvHistoryResponse | undefined) =>
      prev?.underlying === underlying ? prev : undefined,
  });
}

/** Daily close, 30-day IV and realized vol for a TradFi underlying; refreshes with the daily bar. */
export function useTradfiVolHistory(underlying: string) {
  return useQuery({
    queryKey: ['tradfi-vol-history', underlying] as const,
    queryFn: async () =>
      TradfiVolHistoryResponseSchema.parse(
        await tradfiFetchJson<unknown>(`/vol-history?underlying=${encodeURIComponent(underlying)}`),
      ),
    enabled: Boolean(underlying),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: (prev: TradfiVolHistoryResponse | undefined) =>
      prev?.underlying === underlying ? prev : undefined,
  });
}

const TradfiIvHistoryUnderlyingsSchema = z.object({ underlyings: z.array(z.string()) });

/** Tickers the TradFi service records 5-minute IV and skew for. */
export function useTradfiIvHistoryUnderlyings(enabled = true) {
  return useQuery({
    queryKey: ['tradfi-iv-history-underlyings'] as const,
    queryFn: async () =>
      TradfiIvHistoryUnderlyingsSchema.parse(await tradfiFetchJson<unknown>('/iv-history/underlyings'))
        .underlyings,
    enabled,
    staleTime: 10 * 60_000,
  });
}

export const CALL_PUT_FLOW_RESOLUTION_SEC = 3600;

export function useCallPutFlow(underlying: string, days: number, enabled: boolean) {
  return useQuery({
    queryKey: ['call-put-flow', underlying, days] as const,
    queryFn: async () =>
      CallPutFlowResponseSchema.parse(
        await fetchJson<unknown>(
          `/flow/call-put-buckets?underlying=${underlying}&resolution=${CALL_PUT_FLOW_RESOLUTION_SEC}&days=${days}`,
        ),
      ),
    enabled: enabled && Boolean(underlying),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: (prev: CallPutFlowResponse | undefined) =>
      prev?.underlying === underlying ? prev : undefined,
  });
}

export function useAllExpiriesSmile(underlying: string, enabled: boolean) {
  const { data: expiriesData } = useExpiries(enabled ? underlying : '');
  const expiries = expiriesData?.expiries ?? [];
  const venueParam = `&venues=${VENUE_IDS.join(',')}`;

  return useQuery({
    queryKey: ['smile-all', underlying, expiries.join(',')],
    queryFn: async (): Promise<EnrichedChainResponse[]> =>
      Promise.all(
        expiries.map((exp) =>
          fetchJson<EnrichedChainResponse>(`/chains?underlying=${underlying}&expiry=${exp}${venueParam}`),
        ),
      ),
    enabled: Boolean(underlying && expiries.length > 0 && enabled),
    staleTime: 30_000,
    placeholderData: (prev: EnrichedChainResponse[] | undefined) =>
      prev?.[0]?.underlying === underlying ? prev : undefined,
  });
}
