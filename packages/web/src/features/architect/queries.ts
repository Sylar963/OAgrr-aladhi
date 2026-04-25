import { useQuery } from '@tanstack/react-query';

import { fetchJson } from '@lib/http';

export interface SpotCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SpotCandlesResponse {
  currency: string;
  resolution: number;
  count: number;
  candles: SpotCandle[];
}

export const SPOT_CANDLE_CURRENCIES = ['BTC', 'ETH'] as const;
export type SpotCandleCurrency = (typeof SPOT_CANDLE_CURRENCIES)[number];

export function isSpotCandleCurrency(value: string): value is SpotCandleCurrency {
  return (SPOT_CANDLE_CURRENCIES as readonly string[]).includes(value);
}

export function useSpotCandles(currency: string, resolutionSec: number, buckets: number) {
  return useQuery({
    queryKey: ['spot-candles', currency, resolutionSec, buckets],
    queryFn: () =>
      fetchJson<SpotCandlesResponse>(
        `/spot-candles?currency=${currency}&resolution=${resolutionSec}&buckets=${buckets}`,
      ),
    enabled: isSpotCandleCurrency(currency),
    refetchInterval: 120_000,
    staleTime: 120_000,
  });
}
