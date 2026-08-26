import { useQuery } from '@tanstack/react-query';
import { AlphaMarketContextResponseSchema } from '@oggregator/protocol';

import { fetchJson } from '@lib/http';

export function useAlphaMarketContext(underlying: string) {
  const key = underlying.toUpperCase();
  return useQuery({
    queryKey: ['alpha', 'market-context', key],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(`/alpha/market-context?underlying=${key}`);
      return AlphaMarketContextResponseSchema.parse(payload);
    },
    enabled: Boolean(key),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}
