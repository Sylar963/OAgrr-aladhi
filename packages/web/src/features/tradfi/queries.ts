import { useQueries, useQuery } from '@tanstack/react-query';

import { tradfiFetchJson } from '@lib/tradfi-http';
import type { EnrichedChainResponse, GexStrike } from '@shared/enriched';

interface TradfiUnderlyingsResponse {
  underlyings: string[];
}
interface TradfiExpiriesResponse {
  underlying: string;
  expiries: string[];
}

export const tradfiKeys = {
  underlyings: () => ['tradfi-underlyings'] as const,
  expiries: (underlying: string) => ['tradfi-expiries', underlying] as const,
  chain: (underlying: string, expiry: string) => ['tradfi-chain', underlying, expiry] as const,
  gexAll: (underlying: string) => ['tradfi-gex-all', underlying] as const,
};

export function fetchTradfiChain(underlying: string, expiry: string) {
  return tradfiFetchJson<EnrichedChainResponse>(
    `/chains?underlying=${underlying}&expiry=${expiry}`,
  );
}

export function useTradfiUnderlyings(enabled = true) {
  return useQuery({
    queryKey: tradfiKeys.underlyings(),
    queryFn: () => tradfiFetchJson<TradfiUnderlyingsResponse>('/underlyings'),
    enabled,
    staleTime: 60_000,
  });
}

export function useTradfiExpiries(underlying: string) {
  return useQuery({
    queryKey: tradfiKeys.expiries(underlying),
    queryFn: () => tradfiFetchJson<TradfiExpiriesResponse>(`/expiries?underlying=${underlying}`),
    enabled: Boolean(underlying),
    staleTime: 30_000,
    placeholderData: (prev: TradfiExpiriesResponse | undefined) => prev,
  });
}

export function useTradfiChain(underlying: string, expiry: string) {
  return useQuery({
    queryKey: tradfiKeys.chain(underlying, expiry),
    queryFn: () => fetchTradfiChain(underlying, expiry),
    enabled: Boolean(underlying && expiry),
    placeholderData: (prev: EnrichedChainResponse | undefined) => prev,
    refetchInterval: 5000,
  });
}

export function useTradfiChainsForExpiries(
  underlying: string,
  expiries: string[],
): Record<string, EnrichedChainResponse> {
  return useQueries({
    queries: expiries.map((expiry) => ({
      queryKey: tradfiKeys.chain(underlying, expiry),
      queryFn: () => fetchTradfiChain(underlying, expiry),
      enabled: Boolean(underlying && expiry),
      refetchInterval: 5_000,
      staleTime: 4_000,
    })),
    combine: (results) => {
      const byExpiry: Record<string, EnrichedChainResponse> = {};
      results.forEach((result, index) => {
        const expiry = expiries[index];
        if (result.data && expiry) byExpiry[expiry] = result.data;
      });
      return byExpiry;
    },
  });
}

export interface TradfiAllExpiriesGexResponse {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

export function useTradfiAllExpiriesGex(underlying: string, enabled = true) {
  return useQuery({
    queryKey: tradfiKeys.gexAll(underlying),
    queryFn: () =>
      tradfiFetchJson<TradfiAllExpiriesGexResponse>(
        `/gex-all-expiries?underlying=${encodeURIComponent(underlying)}`,
      ),
    enabled: enabled && Boolean(underlying),
    refetchInterval: 5000,
    placeholderData: (prev: TradfiAllExpiriesGexResponse | undefined) => prev,
  });
}
