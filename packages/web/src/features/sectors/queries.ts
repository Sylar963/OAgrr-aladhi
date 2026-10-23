import { fetchJson } from '@lib/http';
import {
  CryptoSectorCorrelationResponseSchema,
  CryptoSectorsResponseSchema,
} from '@oggregator/protocol';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

export function useCryptoSectors() {
  return useQuery({
    queryKey: ['sectors'],
    queryFn: async () => CryptoSectorsResponseSchema.parse(await fetchJson<unknown>('/sectors')),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
}

// The server recomputes once per closed 5m bar.
export function useSectorCorrelation() {
  return useQuery({
    queryKey: ['sectors', 'correlation'],
    queryFn: async () =>
      CryptoSectorCorrelationResponseSchema.parse(
        await fetchJson<unknown>('/sectors/correlation'),
      ),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}
