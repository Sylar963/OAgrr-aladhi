import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import { tradfiFetchJson } from '@lib/tradfi-http';

// Local Zod v4 schemas — mirrors use-tradfi-candles.ts. Do NOT use the protocol's
// Zod v3 schemas: they fail at runtime when composed inside a Zod v4 z.object().
const CandleSchema = z.object({
  ts: z.number().int().nonnegative(),
  o: z.number().nonnegative(),
  h: z.number().nonnegative(),
  l: z.number().nonnegative(),
  c: z.number().nonnegative(),
  vol: z.number().nonnegative(),
  synthetic: z.boolean(),
});

const PayloadSchema = z.object({ candles: z.array(CandleSchema), markLine: z.array(z.unknown()) });

export function parseTradfiUnderlyingCandles(raw: unknown) {
  const p = PayloadSchema.safeParse(raw);
  if (!p.success) throw new Error(`tradfi underlying candles schema mismatch: ${p.error.message}`);
  return p.data;
}

export function useTradfiUnderlyingCandles(args: {
  underlying: string;
  interval: InstrumentCandleInterval;
  range: InstrumentCandleRange;
  enabled?: boolean;
}) {
  const { underlying, interval, range, enabled = true } = args;
  return useQuery({
    queryKey: ['tradfi-underlying-candles', underlying, interval, range],
    queryFn: async () =>
      parseTradfiUnderlyingCandles(
        await tradfiFetchJson(
          `/underlying-candles?underlying=${encodeURIComponent(underlying)}&interval=${interval}&range=${range}`,
        ),
      ),
    enabled: enabled && !!underlying,
    staleTime: 60_000,
  });
}
