import { useQuery } from '@tanstack/react-query';
import { VolRichnessSchema } from '@oggregator/protocol';

import { fetchJson } from '@lib/http';

const RICHNESS_UNDERLYINGS = new Set(['BTC', 'ETH', 'HYPE']);

export function useVolRichness(underlying: string) {
  const key = underlying.toUpperCase();
  return useQuery({
    queryKey: ['vol-richness', key],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(`/vol-richness?underlying=${key}`);
      return VolRichnessSchema.parse(payload);
    },
    enabled: RICHNESS_UNDERLYINGS.has(key),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
