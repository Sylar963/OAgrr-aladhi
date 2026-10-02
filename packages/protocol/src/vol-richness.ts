import { z } from 'zod';

const NullableNumberSchema = z.number().nullable();

export const VolRichnessQuerySchema = z.object({
  underlying: z.string().trim().min(2).max(20).transform((value) => value.toUpperCase()),
});

export type VolRichnessQuery = z.infer<typeof VolRichnessQuerySchema>;

export const VolRichnessStateSchema = z.enum(['cheap', 'fair', 'rich', 'unavailable']);

export type VolRichnessState = z.infer<typeof VolRichnessStateSchema>;

export const VolPremiumBaselineSchema = z.object({
  tenorDays: z.number(),
  source: z.enum(['venue', 'blended']),
  medianSpread: NullableNumberSchema,
  sampleCount: z.number().int().nonnegative(),
  independentSampleCount: z.number().int().nonnegative(),
});

export const TenorRichnessSchema = z.object({
  tenorDays: z.union([z.literal(7), z.literal(30)]),
  atmIv: NullableNumberSchema,
  forecastVol: NullableNumberSchema,
  ivMinusForecast: NullableNumberSchema,
  premiumBaseline: VolPremiumBaselineSchema,
  /** IV − forecast − usual premium, as a fraction (0.02 = 2 vol points). */
  excessPremium: NullableNumberSchema,
  excessChange24h: NullableNumberSchema,
  excessHistory: z.object({
    zScore: NullableNumberSchema,
    percentile: NullableNumberSchema,
    sampleCount: z.number().int().nonnegative(),
    firstTs: NullableNumberSchema,
  }),
  conePercentile: NullableNumberSchema,
  intraday: z.object({
    ivChange24h: NullableNumberSchema,
    zScore24h: NullableNumberSchema,
    zScore7d: NullableNumberSchema,
    samples24h: z.number().int().nonnegative(),
    samples7d: z.number().int().nonnegative(),
  }),
  level: z.object({
    percentile90d: NullableNumberSchema,
    percentile1y: NullableNumberSchema,
  }),
  state: VolRichnessStateSchema,
});

export type TenorRichness = z.infer<typeof TenorRichnessSchema>;

export const VolRichnessSchema = z.object({
  generatedAt: z.number(),
  underlying: z.string(),
  forecast: z.object({
    method: z.literal('mean-reverting-realized-v1'),
    rv7d: NullableNumberSchema,
    rv30d: NullableNumberSchema,
    longRunVol: NullableNumberSchema,
    longRunDays: z.number().int().nonnegative(),
    halfLifeDays: z.number(),
  }),
  tenors: z.object({ '7d': TenorRichnessSchema, '30d': TenorRichnessSchema }),
  termStructure: z.object({
    state: z.enum(['contango', 'flat', 'backwardation', 'unknown']),
    slope: NullableNumberSchema,
  }),
  forecastCurve: z.array(
    z.object({
      dteDays: z.number(),
      forecastVol: NullableNumberSchema,
      usualPremium: NullableNumberSchema,
    }),
  ),
  fairBand: z.number(),
});

export type VolRichness = z.infer<typeof VolRichnessSchema>;
