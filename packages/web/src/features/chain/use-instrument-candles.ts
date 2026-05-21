import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  InstrumentCandlesResponseSchema,
  type InstrumentCandle,
  type InstrumentCandleInterval,
  type InstrumentCandleRange,
  type InstrumentCandlesResponse,
  type VenueId,
} from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import type { EnrichedChainResponse } from '@shared/enriched';

let warmupDone = false;
const warmupPromise = new Promise<void>((resolve) => {
  if (typeof window === 'undefined') { warmupDone = true; resolve(); return; }
  setTimeout(() => { warmupDone = true; resolve(); }, 200);
});

export function applyLiveTick(
  candles: readonly InstrumentCandle[],
  liveMid: number | null,
): InstrumentCandle[] {
  if (liveMid == null || candles.length === 0) return candles as InstrumentCandle[];
  const last = candles[candles.length - 1]!;
  const next: InstrumentCandle = {
    ...last,
    c: liveMid,
    h: Math.max(last.h, liveMid),
    l: Math.min(last.l, liveMid),
  };
  return [...candles.slice(0, -1), next];
}

export interface LiveMid {
  usd: number | null;
  raw: number | null;
}

// Inverse-venue charts (Deribit BTC/ETH, OKX BTC-USD-…) draw candles in base
// currency; everything else draws in USD-equivalent. Pick the leg whose unit
// matches the chart's reported priceCurrency so the live overlay doesn't
// produce a unit-mismatch spike on the active bar.
export function pickLiveMid(
  liveMid: LiveMid | null,
  priceCurrency: string | null,
): number | null {
  if (liveMid == null) return null;
  const useRaw = priceCurrency === 'BTC' || priceCurrency === 'ETH';
  return useRaw ? liveMid.raw : liveMid.usd;
}

interface UseInstrumentCandlesArgs {
  venue: VenueId;
  symbol: string;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  enabled?: boolean;
  liveMid?: LiveMid | null;
}

export function useInstrumentCandles({
  venue,
  symbol,
  interval,
  range,
  enabled = true,
  liveMid = null,
}: UseInstrumentCandlesArgs) {
  const query = useQuery<InstrumentCandlesResponse>({
    queryKey: ['instrument-candles', venue, symbol, interval, range],
    queryFn: async () => {
      if (!warmupDone) await warmupPromise;
      const raw = await fetchJson<unknown>(
        `/instrument-candles?venue=${venue}&symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`,
      );
      const parsed = InstrumentCandlesResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`instrument-candles response did not match schema: ${parsed.error.message}`);
      }
      return parsed.data as InstrumentCandlesResponse;
    },
    enabled,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const priceCurrency = query.data?.priceCurrency ?? null;
  const candles = useMemo(
    () => applyLiveTick(query.data?.candles ?? [], pickLiveMid(liveMid, priceCurrency)),
    [query.data?.candles, liveMid, priceCurrency],
  );

  return {
    ...query,
    candles,
    markLine: query.data?.markLine ?? [],
    priceCurrency,
  };
}

export function useLiveMidFromChain(
  underlying: string,
  expiry: string,
  strike: number,
  type: 'call' | 'put',
  venue: VenueId,
): LiveMid | null {
  const qc = useQueryClient();
  const entries = qc.getQueriesData<EnrichedChainResponse>({
    queryKey: ['chain', underlying, expiry],
  });
  for (const [, data] of entries) {
    if (!data) continue;
    const row = data.strikes.find((s) => s.strike === strike);
    if (!row) continue;
    const side = type === 'call' ? row.call : row.put;
    const q = side.venues[venue];
    if (!q) continue;
    if (q.mid == null && q.midRaw == null) continue;
    return { usd: q.mid ?? null, raw: q.midRaw ?? null };
  }
  return null;
}
