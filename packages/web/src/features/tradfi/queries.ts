import { useQuery } from '@tanstack/react-query';

import { tradfiFetchJson } from '@lib/tradfi-http';
import type { EnrichedChainResponse } from '@shared/enriched';

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
};

export function fetchTradfiChain(underlying: string, expiry: string) {
  return tradfiFetchJson<EnrichedChainResponse>(
    `/chains?underlying=${underlying}&expiry=${expiry}`,
  );
}

export function useTradfiUnderlyings() {
  return useQuery({
    queryKey: tradfiKeys.underlyings(),
    queryFn: () => tradfiFetchJson<TradfiUnderlyingsResponse>('/underlyings'),
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
