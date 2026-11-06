import { fetchJson } from '@lib/http';
import {
  FlowStrikeMapResponseSchema,
  InstrumentTradesResponseSchema,
} from '@oggregator/protocol';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';
import type { HistoryRange } from './queries';

const InstrumentRowSchema = z.object({
  instrument: z.string(),
  count: z.number(),
  lastTs: z.string(),
  lastPrice: z.number().nullable(),
  lastReferencePriceUsd: z.number().nullable(),
  lastIv: z.number().nullable(),
  lastIvAt: z.string().nullable(),
  optionType: z.enum(['call', 'put']).nullable(),
  strike: z.number().nullable(),
  expiry: z.string().nullable(),
});
export type InstrumentRow = z.infer<typeof InstrumentRowSchema>;

const InstrumentListResponseSchema = z.object({
  available: z.boolean(),
  instruments: z.array(InstrumentRowSchema),
});

const SpotCandleRangeResponseSchema = z.object({
  currency: z.string(),
  resolution: z.number(),
  count: z.number(),
  candles: z.array(
    z.object({
      timestamp: z.number(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number().optional(),
    }),
  ),
  source: z.string().optional(),
});
export type HistoricalPriceCandle = z.infer<typeof SpotCandleRangeResponseSchema>['candles'][number];

export interface FlowStrikeMapQueryArgs {
  underlying: string;
  venue: string;
  expiry: string;
  range: HistoryRange;
  resolution: number;
}

export interface SpotCandleRangeQueryArgs {
  underlying: string;
  range: HistoryRange;
  resolution: number;
}

export interface InstrumentListQueryArgs {
  underlying: string;
  venue: string;
  range: HistoryRange;
  limit?: number;
}

export interface InstrumentTradesQueryArgs {
  underlying: string;
  venue: string;
  instrument: string;
  range: HistoryRange;
  limit?: number;
}

interface ResponseSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

async function fetchAndValidate<T>(path: string, schema: ResponseSchema<T>): Promise<T> {
  const raw = await fetchJson<unknown>(path);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid response from ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function useInstrumentList(args: InstrumentListQueryArgs, enabled = true) {
  const params = useMemo(() => {
    const p = new URLSearchParams({ underlying: args.underlying, venue: args.venue });
    if (args.range.start) p.set('start', args.range.start);
    if (args.range.end) p.set('end', args.range.end);
    if (args.limit) p.set('limit', String(args.limit));
    return p;
  }, [args.underlying, args.venue, args.range.start, args.range.end, args.limit]);

  return useQuery({
    queryKey: [
      'flow-instruments',
      args.underlying,
      args.venue,
      args.range.start,
      args.range.end,
      args.limit,
    ],
    queryFn: () =>
      fetchAndValidate(`/flow/instruments?${params.toString()}`, InstrumentListResponseSchema),
    enabled: Boolean(args.underlying && args.venue) && enabled,
  });
}

export function useInstrumentTrades(args: InstrumentTradesQueryArgs, enabled = true) {
  const params = useMemo(() => {
    const p = new URLSearchParams({
      underlying: args.underlying,
      venue: args.venue,
      instrument: args.instrument,
    });
    if (args.range.start) p.set('start', args.range.start);
    if (args.range.end) p.set('end', args.range.end);
    if (args.limit) p.set('limit', String(args.limit));
    return p;
  }, [args.underlying, args.venue, args.instrument, args.range.start, args.range.end, args.limit]);

  return useQuery({
    queryKey: [
      'flow-instrument-trades',
      args.underlying,
      args.venue,
      args.instrument,
      args.range.start,
      args.range.end,
      args.limit,
    ],
    queryFn: () =>
      fetchAndValidate(
        `/flow/instrument-trades?${params.toString()}`,
        InstrumentTradesResponseSchema,
      ),
    enabled: Boolean(args.underlying && args.venue && args.instrument) && enabled,
    refetchInterval: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useFlowStrikeMap(args: FlowStrikeMapQueryArgs, enabled = true) {
  const params = useMemo(() => {
    const p = new URLSearchParams({
      underlying: args.underlying,
      venue: args.venue,
      expiry: args.expiry,
      start: args.range.start ?? '',
      end: args.range.end ?? '',
      resolution: String(args.resolution),
    });
    return p;
  }, [args.underlying, args.venue, args.expiry, args.range.start, args.range.end, args.resolution]);

  return useQuery({
    queryKey: [
      'flow-strike-map',
      args.underlying,
      args.venue,
      args.expiry,
      args.range.start,
      args.range.end,
      args.resolution,
    ],
    queryFn: () => fetchAndValidate(`/flow/strike-map?${params.toString()}`, FlowStrikeMapResponseSchema),
    enabled:
      Boolean(args.underlying && args.venue && args.expiry && args.range.start && args.range.end) &&
      enabled,
    staleTime: 30_000,
  });
}

export function useSpotCandleRange(args: SpotCandleRangeQueryArgs, enabled = true) {
  const params = useMemo(
    () =>
      new URLSearchParams({
        currency: args.underlying,
        resolution: String(args.resolution),
        start: args.range.start ?? '',
        end: args.range.end ?? '',
        source: 'perp',
      }),
    [args.underlying, args.range.start, args.range.end, args.resolution],
  );

  return useQuery({
    queryKey: [
      'flow-spot-candles',
      args.underlying,
      args.range.start,
      args.range.end,
      args.resolution,
    ],
    queryFn: () => fetchAndValidate(`/spot-candles?${params.toString()}`, SpotCandleRangeResponseSchema),
    enabled: Boolean(args.underlying && args.range.start && args.range.end) && enabled,
    staleTime: 30_000,
  });
}
