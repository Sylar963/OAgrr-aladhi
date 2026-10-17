import { z } from 'zod';

export const TIME_AT_PRICE_UNDERLYINGS = ['BTC', 'ETH', 'HYPE'] as const;
export const TIME_AT_PRICE_LOOKBACK_DAYS = [90, 180, 365, 730] as const;
export const TIME_AT_PRICE_RESOLUTION_SEC = 3600;

export const TimeAtPriceQuerySchema = z.object({
  underlying: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(TIME_AT_PRICE_UNDERLYINGS)),
  lookbackDays: z.coerce
    .number()
    .int()
    .refine((days) => (TIME_AT_PRICE_LOOKBACK_DAYS as readonly number[]).includes(days), {
      message: `lookbackDays must be one of ${TIME_AT_PRICE_LOOKBACK_DAYS.join(', ')}`,
    })
    .default(730),
});

export type TimeAtPriceQuery = z.infer<typeof TimeAtPriceQuerySchema>;

export const TimeAtPriceResponseSchema = z.object({
  underlying: z.string(),
  asOf: z.number().int(),
  lookbackDays: z.number().int(),
  resolutionSec: z.literal(TIME_AT_PRICE_RESOLUTION_SEC),
  /** First and last counted bar, epoch ms. Shorter than the lookback when the venue has less history. */
  from: z.number().int(),
  to: z.number().int(),
  bars: z.number().int(),
  spot: z.number(),
  binSize: z.number(),
  volBinSize: z.number(),
  volWindowHours: z.number().int(),
  /** `price` is the lower bin edge; `bars` = hourly bars whose low–high range contains it. */
  levels: z.array(z.object({ price: z.number(), bars: z.number().int() })),
  /** Mean trailing Parkinson vol (annualized fraction) of bars whose mid fell in the bin. */
  volByLevel: z.array(z.object({ price: z.number(), vol: z.number(), bars: z.number().int() })),
  dailyCloses: z.array(z.object({ ts: z.number().int(), close: z.number() })),
});

export type TimeAtPriceResponse = z.infer<typeof TimeAtPriceResponseSchema>;
