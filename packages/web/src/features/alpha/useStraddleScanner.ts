import { useQuery } from '@tanstack/react-query';
import {
  AlphaStraddleScannerResponseSchema,
  ShortStraddleEvaluationResponseSchema,
  type AlphaStraddleScannerQuery,
} from '@oggregator/protocol';

import { fetchJson } from '@lib/http';

export function useStraddleScanner(config: AlphaStraddleScannerQuery, enabled = true) {
  const params = new URLSearchParams({
    underlying: config.underlying,
    venues: config.venues.join(','),
    minDte: String(config.minDte),
    maxDte: String(config.maxDte),
    equity: String(config.equity),
    riskPct: String(config.riskPct),
    stressSigma: String(config.stressSigma),
    maxSpreadPct: String(config.maxSpreadPct),
    limit: String(config.limit),
  });

  return useQuery({
    queryKey: ['alpha', 'straddle-scanner', config],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(`/alpha/straddle-scanner?${params.toString()}`);
      return AlphaStraddleScannerResponseSchema.parse(payload);
    },
    enabled,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

const EVIDENCE_UNDERLYINGS = new Set(['BTC', 'ETH']);

export function useShortStraddleEvidence(underlying: string) {
  const key = underlying.toUpperCase();
  return useQuery({
    queryKey: ['alpha', 'short-straddle-evaluation', key],
    queryFn: async () => {
      const payload = await fetchJson<unknown>(`/alpha/short-straddle-evaluation?underlying=${key}`);
      return ShortStraddleEvaluationResponseSchema.parse(payload);
    },
    enabled: EVIDENCE_UNDERLYINGS.has(key),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
