import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';

import { chainKeys } from '@features/chain/queries';
import { fetchJson } from '@lib/http';
import type { EnrichedChainResponse } from '@shared/enriched';

export interface SpotCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SpotCandlesResponse {
  currency: string;
  resolution: number;
  count: number;
  candles: SpotCandle[];
}

export const SPOT_CANDLE_CURRENCIES = ['BTC', 'ETH', 'HYPE'] as const;
export type SpotCandleCurrency = (typeof SPOT_CANDLE_CURRENCIES)[number];

export function isSpotCandleCurrency(value: string): value is SpotCandleCurrency {
  return (SPOT_CANDLE_CURRENCIES as readonly string[]).includes(value);
}

export function hasUsableSpotCandles(
  response: SpotCandlesResponse | null | undefined,
): response is SpotCandlesResponse {
  return (response?.candles.length ?? 0) > 0;
}

/**
 * Chains for the builder's extra tenors, keyed by expiry. REST-only and polled —
 * the live WS chain subscription stays on the primary builder expiry (transport
 * untouched); these keep legs on other tenors priced and make ladder tenor
 * drops land on fresh quotes.
 */
export function useChainsForExpiries(
  underlying: string,
  expiries: string[],
  venues: string[],
): Record<string, EnrichedChainResponse> {
  const venueParam = venues.length > 0 ? `&venues=${venues.join(',')}` : '';
  return useQueries({
    queries: expiries.map((expiry) => ({
      queryKey: chainKeys.chain(underlying, expiry, venues),
      queryFn: () =>
        fetchJson<EnrichedChainResponse>(
          `/chains?underlying=${underlying}&expiry=${expiry}${venueParam}`,
        ),
      enabled: Boolean(underlying && expiry),
      refetchInterval: 15_000,
      staleTime: 10_000,
    })),
    combine: (results) => {
      const byExpiry: Record<string, EnrichedChainResponse> = {};
      results.forEach((result, i) => {
        const expiry = expiries[i];
        if (result.data && expiry) byExpiry[expiry] = result.data;
      });
      return byExpiry;
    },
  });
}

export function useSpotCandles(
  currency: string,
  resolutionSec: number,
  buckets: number,
  refetchIntervalMs: number,
) {
  return useQuery({
    queryKey: ['spot-candles', currency, resolutionSec, buckets],
    queryFn: () =>
      fetchJson<SpotCandlesResponse>(
        `/spot-candles?currency=${currency}&resolution=${resolutionSec}&buckets=${buckets}`,
      ),
    enabled: isSpotCandleCurrency(currency),
    refetchInterval: refetchIntervalMs,
    staleTime: refetchIntervalMs,
    // fetchJson already retries on 503/network up to 10x. Cap query-level
    // retries at 1 so a real upstream failure surfaces in seconds, not
    // minutes — the banner has an explicit error state for this case.
    retry: 1,
    // Tenor changes swap the query key. keepPreviousData holds the previous
    // candles on screen while the new fetch is in flight so the banner never
    // flashes "Loading snapshot…" mid-strategy edit.
    placeholderData: keepPreviousData,
  });
}
