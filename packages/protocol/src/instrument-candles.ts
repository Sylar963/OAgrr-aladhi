import { z } from 'zod';
import { VenueIdSchema } from './ws.js';

export const InstrumentCandleIntervalSchema = z.enum([
  '1m', '5m', '15m', '1h', '4h', '1d',
]);
export type InstrumentCandleInterval = z.infer<typeof InstrumentCandleIntervalSchema>;

export const InstrumentCandleRangeSchema = z.enum(['1d', '7d', '30d', 'max']);
export type InstrumentCandleRange = z.infer<typeof InstrumentCandleRangeSchema>;

export const InstrumentCandleSchema = z.object({
  ts: z.number().int().nonnegative(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  vol: z.number().nonnegative(),
  synthetic: z.boolean(),
});
export type InstrumentCandle = z.infer<typeof InstrumentCandleSchema>;

export const InstrumentMarkPointSchema = z.object({
  ts: z.number().int().nonnegative(),
  c: z.number(),
});
export type InstrumentMarkPoint = z.infer<typeof InstrumentMarkPointSchema>;

export const InstrumentCandlesResponseSchema = z.object({
  venue: VenueIdSchema,
  symbol: z.string(),
  interval: InstrumentCandleIntervalSchema,
  candles: z.array(InstrumentCandleSchema),
  markLine: z.array(InstrumentMarkPointSchema),
});
export type InstrumentCandlesResponse = z.infer<typeof InstrumentCandlesResponseSchema>;
