import { useQuery } from '@tanstack/react-query';
import {
  AlphaIronFlyScannerResponseSchema,
  type AlphaIronFlyScannerQuery,
} from '@oggregator/protocol';

import { fetchJson } from '@lib/http';

export function useIronFlyScanner(config: AlphaIronFlyScannerQuery, enabled = true) {
  const params = new URLSearchParams({
    underlying: config.underlying,
    venues: config.venues.join(','),
    minDte: String(config.minDte),
    maxDte: String(config.maxDte),
    equity: String(config.equity),
    riskPct: String(config.riskPct),
    maxSpreadPct: String(config.maxSpreadPct),
    lookbackWeeks: String(config.lookbackWeeks),
    limit: String(config.limit),
  });

  return useQuery({
    queryKey: ['alpha', 'iron-fly-scanner', config],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(`/alpha/iron-fly-scanner?${params.toString()}`);
      return AlphaIronFlyScannerResponseSchema.parse(payload);
    },
    enabled,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}
