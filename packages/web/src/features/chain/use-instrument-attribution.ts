import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  InstrumentCandlesResponseSchema,
  type InstrumentCandleInterval,
  type InstrumentCandleRange,
  type InstrumentCandlesResponse,
  type InstrumentMarkPoint,
  type VenueId,
} from '@oggregator/protocol';
import type { EnrichedChainResponse } from '@shared/enriched';
import { fetchJson } from '@lib/http';
import {
  attributePnL,
  type AttributionBar,
  type AttributionResult,
  type OptionRight,
} from './pnl-attribution.js';

// Mirrors @oggregator/core SpotCandle shape (no cross-package import per repo rule).
interface ForwardCandle {
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
  candles: ForwardCandle[];
}

const INTERVAL_TO_SEC: Record<InstrumentCandleInterval, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

const RANGE_TO_MS: Record<InstrumentCandleRange, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  max: 365 * 24 * 60 * 60 * 1000,
};

const SERVER_BUCKET_CAP = 3000;

export function intervalToResolutionSec(interval: InstrumentCandleInterval): number {
  return INTERVAL_TO_SEC[interval];
}

export function rangeToBuckets(
  range: InstrumentCandleRange, interval: InstrumentCandleInterval,
): number {
  const intervalMs = INTERVAL_TO_SEC[interval] * 1000;
  const raw = Math.ceil(RANGE_TO_MS[range] / intervalMs);
  return Math.min(SERVER_BUCKET_CAP, Math.max(1, raw));
}

// Join option mark series to forward closes by exact-bucket match on the
// option timestamp. Forward bars at the same ts win. Bars without a forward
// match are dropped — attribution needs both sides.
export function alignBarsForAttribution(
  optionMarks: readonly InstrumentMarkPoint[],
  forwardCandles: readonly ForwardCandle[],
): AttributionBar[] {
  const fwdByTs = new Map<number, ForwardCandle>();
  for (const c of forwardCandles) fwdByTs.set(c.timestamp, c);
  const bars: AttributionBar[] = [];
  for (const m of optionMarks) {
    const f = fwdByTs.get(m.ts);
    if (!f) continue;
    bars.push({ ts: m.ts, mark: m.c, forward: f.close });
  }
  bars.sort((a, b) => a.ts - b.ts);
  return bars;
}

// Read the chain expiration timestamp from the in-memory TanStack cache. The
// chain query key is ['chain', underlying, expiry] and the response carries
// expiryTs at the top level (shared across the whole chain). When no cached
// response exists yet (the user hasn't opened the chain for this expiry),
// returns null and the caller treats it as not-ready.
function lookupExpirationMs(
  qc: ReturnType<typeof useQueryClient>,
  underlying: string,
  expiry: string,
): number | null {
  const entries = qc.getQueriesData<EnrichedChainResponse>({ queryKey: ['chain', underlying, expiry] });
  for (const [, data] of entries) {
    if (data?.expiryTs != null) return data.expiryTs;
  }
  return null;
}

export const ATTRIBUTION_SUPPORTED_UNDERLYINGS = new Set(['BTC', 'ETH']);

export interface UseInstrumentAttributionArgs {
  venue: VenueId;
  symbol: string;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  underlying: string;
  strike: number;
  right: OptionRight;
  expiry: string;
  enabled?: boolean;
}

export interface UseInstrumentAttributionResult {
  result: AttributionResult | null;
  isLoading: boolean;
  error: Error | null;
  unsupportedUnderlying: boolean;
  /** True when the option candle response was empty (e.g. illiquid strike). */
  insufficientData: boolean;
}

export function useInstrumentAttribution(
  args: UseInstrumentAttributionArgs,
): UseInstrumentAttributionResult {
  const { venue, symbol, interval, range, underlying, strike, right, expiry, enabled = true } = args;
  const qc = useQueryClient();
  const unsupportedUnderlying = !ATTRIBUTION_SUPPORTED_UNDERLYINGS.has(underlying);

  // Option marks via the existing /api/instrument-candles route.
  const optionQuery = useQuery<InstrumentCandlesResponse>({
    queryKey: ['instrument-candles', venue, symbol, interval, range],
    queryFn: async () => {
      const raw = await fetchJson<unknown>(
        `/instrument-candles?venue=${venue}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`,
      );
      const parsed = InstrumentCandlesResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`instrument-candles schema mismatch: ${parsed.error.message}`);
      }
      return parsed.data as InstrumentCandlesResponse;
    },
    enabled: enabled && !unsupportedUnderlying,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  // Forward proxy via existing /api/spot-candles (Deribit perpetual).
  const forwardQuery = useQuery<SpotCandlesResponse>({
    queryKey: ['spot-candles', underlying, intervalToResolutionSec(interval), rangeToBuckets(range, interval)],
    queryFn: () => fetchJson<SpotCandlesResponse>(
      `/spot-candles?currency=${underlying}&resolution=${intervalToResolutionSec(interval)}&buckets=${rangeToBuckets(range, interval)}`,
    ),
    enabled: enabled && !unsupportedUnderlying,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const expirationMs = lookupExpirationMs(qc, underlying, expiry);

  const computed = useMemo<AttributionResult | null>(() => {
    if (unsupportedUnderlying) return null;
    if (!optionQuery.data || !forwardQuery.data || expirationMs == null) return null;
    const bars = alignBarsForAttribution(optionQuery.data.markLine, forwardQuery.data.candles);
    if (bars.length < 2) return null;
    return attributePnL({ bars, strike, right, expirationMs });
  }, [unsupportedUnderlying, optionQuery.data, forwardQuery.data, expirationMs, strike, right]);

  const isLoading = optionQuery.isLoading || forwardQuery.isLoading;
  const error = (optionQuery.error ?? forwardQuery.error) as Error | null;
  const insufficientData =
    !isLoading && !error && computed == null && !unsupportedUnderlying;

  return { result: computed, isLoading, error, unsupportedUnderlying, insufficientData };
}
