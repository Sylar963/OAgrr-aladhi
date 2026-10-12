import {
  type CallPutFlowResponse,
  CallPutFlowResponseSchema,
  type TradfiVolHistoryResponse,
  TradfiVolHistoryResponseSchema,
} from '@oggregator/protocol';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { useExpiries } from '@features/chain';
import { fetchTradfiChain, useTradfiExpiries } from '@features/tradfi';
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
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: (prev: IvSurfaceResponse | undefined) => prev,
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
    placeholderData: (prev: IvHistoryResponse | undefined) => prev,
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

export function useAllExpiriesSmile(
  underlying: string,
  enabled: boolean,
  market: SurfaceMarket = 'crypto',
) {
  const tradfi = market === 'tradfi';
  const { data: cryptoExpiries } = useExpiries(tradfi ? '' : underlying);
  const { data: tradfiExpiries } = useTradfiExpiries(tradfi ? underlying : '');
  const expiries = (tradfi ? tradfiExpiries : cryptoExpiries)?.expiries ?? [];
  const venueParam = `&venues=${VENUE_IDS.join(',')}`;

  return useQuery({
    queryKey: [tradfi ? 'tradfi-smile-all' : 'smile-all', underlying, expiries.join(',')],
    queryFn: async (): Promise<EnrichedChainResponse[]> => {
      const results = await Promise.all(
        expiries.map((exp) =>
          tradfi
            ? fetchTradfiChain(underlying, exp)
            : fetchJson<EnrichedChainResponse>(
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
