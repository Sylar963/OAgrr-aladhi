import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type {
  InstrumentCandleInterval,
  InstrumentCandleRange,
} from '@oggregator/protocol';
import { tradfiFetchJson } from '@lib/tradfi-http';

// Local Zod v4 schemas — do NOT use InstrumentCandleSchema / InstrumentMarkPointSchema
// from @oggregator/protocol: those are built with Zod v3 and fail at runtime when
// composed inside a Zod v4 z.object(). We also intentionally skip `venue: VenueIdSchema`
// here (it would reject 'tastytrade' anyway).
const CandleSchema = z.object({
  ts: z.number().int().nonnegative(),
  o: z.number().nonnegative(),
  h: z.number().nonnegative(),
  l: z.number().nonnegative(),
  c: z.number().nonnegative(),
  vol: z.number().nonnegative(),
  synthetic: z.boolean(),
});

const MarkPointSchema = z.object({
  ts: z.number().int().nonnegative(),
  c: z.number().nonnegative(),
});

const PayloadSchema = z.object({
  candles: z.array(CandleSchema),
  markLine: z.array(MarkPointSchema),
});

export function parseTradfiCandles(raw: unknown) {
  const p = PayloadSchema.safeParse(raw);
  if (!p.success) throw new Error(`tradfi candles schema mismatch: ${p.error.message}`);
  return p.data;
}

export function useTradfiCandles(args: {
  underlying: string;
  expiry: string;
  strike: number | null;
  right: 'call' | 'put';
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  enabled?: boolean;
}) {
  const { underlying, expiry, strike, right, interval, range, enabled = true } = args;
  return useQuery({
    queryKey: ['tradfi-candles', underlying, expiry, strike, right, interval, range],
    queryFn: async () =>
      parseTradfiCandles(
        await tradfiFetchJson(
          `/candles?underlying=${encodeURIComponent(underlying)}&expiry=${expiry}&strike=${strike}&right=${right}&interval=${interval}&range=${range}`,
        ),
      ),
    enabled: enabled && strike != null && !!expiry,
    staleTime: 30_000,
  });
}
