import { useQuery } from '@tanstack/react-query';
import {
  AlphaPutScannerResponseSchema,
  type AlphaPutScannerQuery,
} from '@oggregator/protocol';

import { fetchJson } from '@lib/http';

export function usePutScanner(config: AlphaPutScannerQuery, enabled = true) {
  const params = new URLSearchParams({
    underlying: config.underlying,
    venues: config.venues.join(','),
    premiumCap: String(config.premiumCap),
    minDte: String(config.minDte),
    maxDte: String(config.maxDte),
    minOtmPct: String(config.minOtmPct),
    maxOtmPct: String(config.maxOtmPct),
    hedgeQty: String(config.hedgeQty),
    buyingPower: String(config.buyingPower),
    marginHaircut: String(config.marginHaircut),
    maxSpreadPct: String(config.maxSpreadPct),
    rankBy: config.rankBy,
    limit: String(config.limit),
    diversifyExpiries: String(config.diversifyExpiries),
  });

  return useQuery({
    queryKey: ['alpha', 'put-scanner', config],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(`/alpha/put-scanner?${params.toString()}`);
      return AlphaPutScannerResponseSchema.parse(payload);
    },
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
