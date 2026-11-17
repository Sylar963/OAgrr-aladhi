import { tradfiFetchJson } from '@lib/tradfi-http';
import { TradfiAnalyticsResponseSchema, TradfiParityResponseSchema } from '@oggregator/protocol';
import { useQuery } from '@tanstack/react-query';

export function useTradfiAnalytics(underlying: string, expiry: string) {
  return useQuery({
    queryKey: ['tradfi-analytics', underlying, expiry],
    queryFn: async () => {
      const params = new URLSearchParams({ underlying });
      if (expiry) params.set('expiry', expiry);
      return TradfiAnalyticsResponseSchema.parse(
        await tradfiFetchJson<unknown>(`/analytics?${params}`),
      );
    },
    enabled: Boolean(underlying),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function useTradfiParity(underlying: string, expiry: string) {
  return useQuery({
    queryKey: ['tradfi-parity', underlying, expiry],
    queryFn: async () => {
      const params = new URLSearchParams({ underlying, expiry });
      return TradfiParityResponseSchema.parse(
        await tradfiFetchJson<unknown>(`/analytics/parity?${params}`),
      );
    },
    enabled: Boolean(underlying && expiry),
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}
