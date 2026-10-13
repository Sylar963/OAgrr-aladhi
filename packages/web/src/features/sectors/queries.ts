import { CryptoSectorsResponseSchema } from '@oggregator/protocol';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';

export function useCryptoSectors() {
  return useQuery({
    queryKey: ['sectors'],
    queryFn: async () => CryptoSectorsResponseSchema.parse(await fetchJson<unknown>('/sectors')),
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
}
