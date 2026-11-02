// packages/web/src/features/analytics/oi-by-strike/queries.ts
import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';
import { spotChartCandlesKey, spotChartCandlesPath } from '@lib/spot-chart-candles';
import type {
  BlockStrikeBucketsResponse,
  SpotCandleCurrency,
  SpotCandleResolutionSec,
  SpotCandlesResponse,
} from '@shared/common';

export function useSpotCandles(
  currency: SpotCandleCurrency,
  resolution: SpotCandleResolutionSec,
  buckets: number,
) {
  return useQuery({
    queryKey: spotChartCandlesKey(currency, resolution, buckets),
    queryFn: () =>
      fetchJson<SpotCandlesResponse>(spotChartCandlesPath(currency, resolution, buckets)),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: SpotCandlesResponse | undefined) => prev,
  });
}

export function useBlockStrikeBuckets(
  currency: SpotCandleCurrency,
  resolution: SpotCandleResolutionSec,
  startSec: number | null,
) {
  return useQuery({
    queryKey: ['block-strike-buckets', currency, resolution, startSec],
    queryFn: () =>
      fetchJson<BlockStrikeBucketsResponse>(
        `/block-flow/strike-buckets?underlying=${currency}&resolution=${resolution}&start=${new Date(startSec! * 1000).toISOString()}`,
      ),
    enabled: startSec != null,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: BlockStrikeBucketsResponse | undefined) =>
      prev?.resolution === resolution && prev.underlying === currency ? prev : undefined,
  });
}
