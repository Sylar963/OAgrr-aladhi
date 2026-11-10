import { useQuery } from '@tanstack/react-query';
import { AlphaMarketContextResponseSchema } from '@oggregator/protocol';

import { fetchJson } from '@lib/http';

export interface AlphaContextHorizon {
  expiryTs?: number;
  horizonDays?: number;
  selectedIv?: number;
  ivAsOfMs?: number;
  selectedSkew?: number;
  selectedBfly?: number;
  scope?: string;
}

export function useAlphaMarketContext(
  underlying: string,
  enabled = true,
  horizon: AlphaContextHorizon = {},
) {
  const key = underlying.toUpperCase();
  return useQuery({
    queryKey: [
      'alpha',
      'market-context',
      key,
      horizon.expiryTs ?? horizon.horizonDays ?? 7,
      horizon.scope ?? 'all',
      horizon.selectedIv != null,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ underlying: key });
      for (const [name, value] of Object.entries(horizon)) {
        if (name !== 'scope' && value != null) params.set(name, String(value));
      }
      const payload = await fetchJson<unknown>(`/alpha/market-context?${params}`);
      return AlphaMarketContextResponseSchema.parse(payload);
    },
    enabled: enabled && Boolean(key),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}
