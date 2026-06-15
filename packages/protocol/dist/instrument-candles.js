import { z } from 'zod';
import { VenueIdSchema } from './ws.js';
export const InstrumentCandleIntervalSchema = z.enum([
    '1m', '5m', '15m', '1h', '4h', '1d',
]);
export const InstrumentCandleRangeSchema = z.enum(['1d', '7d', '30d', 'max']);
export const InstrumentCandleSchema = z.object({
    ts: z.number().int().nonnegative(),
    o: z.number().nonnegative(),
    h: z.number().nonnegative(),
    l: z.number().nonnegative(),
    c: z.number().nonnegative(),
    vol: z.number().nonnegative(),
    synthetic: z.boolean(),
});
export const InstrumentMarkPointSchema = z.object({
    ts: z.number().int().nonnegative(),
    c: z.number().nonnegative(),
});
export const InstrumentCandlesResponseSchema = z.object({
    venue: VenueIdSchema,
    symbol: z.string(),
    interval: InstrumentCandleIntervalSchema,
    candles: z.array(InstrumentCandleSchema),
    markLine: z.array(InstrumentMarkPointSchema),
    priceCurrency: z.string().min(1).max(8),
});
export const InstrumentCandlesQuerySchema = z.object({
    venue: VenueIdSchema,
    symbol: z.string().min(1).max(64),
    interval: InstrumentCandleIntervalSchema,
    range: InstrumentCandleRangeSchema,
});
//# sourceMappingURL=instrument-candles.js.map