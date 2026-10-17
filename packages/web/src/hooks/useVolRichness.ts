import { useQuery } from '@tanstack/react-query';
import { isSpotCandleUnderlying, VolRichnessSchema } from '@oggregator/protocol';

import { fetchJson } from '@lib/http';

export function useVolRichness(underlying: string) {
  const key = underlying.toUpperCase();
  return useQuery({
    queryKey: ['vol-richness', key],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(`/vol-richness?underlying=${key}`);
      return VolRichnessSchema.parse(payload);
    },
    enabled: isSpotCandleUnderlying(key),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
