import { PremiumSpikeResponseSchema, type PremiumSpikeQuery } from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import { useQuery } from '@tanstack/react-query';

export function usePremiumSpikes(
  underlying: PremiumSpikeQuery['underlying'] | null,
  venue: PremiumSpikeQuery['venue'],
) {
  return useQuery({
    queryKey: ['premium-spikes', underlying, venue],
    queryFn: async () =>
      PremiumSpikeResponseSchema.parse(
        await fetchJson<unknown>(
          `/premium-spikes?${new URLSearchParams({ underlying: underlying!, venue })}`,
        ),
      ),
    enabled: underlying != null,
    staleTime: 2_000,
    refetchInterval: 5_000,
  });
}
