import { useQuery } from '@tanstack/react-query';
import {
  AlphaLottoScannerResponseSchema,
  type AlphaLottoScannerQuery,
} from '@oggregator/protocol';

import { fetchJson } from '@lib/http';

export function useLottoScanner(config: AlphaLottoScannerQuery) {
  const params = new URLSearchParams({
    premiumCap: String(config.premiumCap),
    minDte: String(config.minDte),
    maxDte: String(config.maxDte),
    minOtmPct: String(config.minOtmPct),
    maxOtmPct: String(config.maxOtmPct),
    buyingPower: String(config.buyingPower),
    marginHaircut: String(config.marginHaircut),
    maxSpreadPct: String(config.maxSpreadPct),
    limit: String(config.limit),
  });

  return useQuery({
    queryKey: ['alpha', 'lotto-scanner', config],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(`/alpha/lotto-scanner?${params.toString()}`);
      return AlphaLottoScannerResponseSchema.parse(payload);
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
