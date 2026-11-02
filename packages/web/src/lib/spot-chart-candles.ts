import { isAggregatedSpotUnderlying } from '@oggregator/protocol';

/**
 * Crypto charts read real spot aggregated across venues. Equities, indexes and
 * commodities stay on /spot-candles, which serves Hyperliquid perps.
 */
export function spotChartCandlesPath(currency: string, resolution: number, buckets: number): string {
  const route = isAggregatedSpotUnderlying(currency) ? 'spot-aggregate-candles' : 'spot-candles';
  return `/${route}?currency=${currency}&resolution=${resolution}&buckets=${buckets}`;
}

// Kept apart from 'spot-candles', which caches perp candles for attribution.
export function spotChartCandlesKey(currency: string, resolution: number, buckets: number) {
  return ['spot-chart-candles', currency, resolution, buckets] as const;
}
