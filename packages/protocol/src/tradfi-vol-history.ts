import { z } from 'zod';
import { VolConeBandSchema } from './vol-richness.js';

/** One trading day. `iv` and `rv` are annualized fractions. */
export const TradfiVolPointSchema = z.object({
  ts: z.number().int(),
  close: z.number(),
  iv: z.number().nullable(),
  rv: z.number().nullable(),
});
export type TradfiVolPoint = z.infer<typeof TradfiVolPointSchema>;

/** Where the latest value sits in its trailing `lookbackDays` trading days. Rank and percentile are 0–100. */
export const TradfiVolRankSchema = z.object({
  lookbackDays: z.number().int().positive(),
  rank: z.number().nullable(),
  percentile: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  sampleCount: z.number().int().nonnegative(),
});
export type TradfiVolRank = z.infer<typeof TradfiVolRankSchema>;

/** GET /vol-history on the TradFi service: daily closes, 30-day IV and realized vol. */
export const TradfiVolHistoryResponseSchema = z.object({
  underlying: z.string().min(1),
  /** 'IVx' is the underlying's own 30-day IV; otherwise the vol index (VIX, RVX) standing in for it. */
  ivSource: z.string().min(1),
  rvWindowDays: z.number().int().positive(),
  periodsPerYear: z.number().int().positive(),
  series: z.array(TradfiVolPointSchema),
  ivRank: z.object({ '6m': TradfiVolRankSchema, '1y': TradfiVolRankSchema }),
  rvRank: z.object({ '6m': TradfiVolRankSchema, '1y': TradfiVolRankSchema }),
  /** horizonDays is calendar days; windowDays is the trading-day window it maps to. */
  volCone: z.array(VolConeBandSchema),
});
export type TradfiVolHistoryResponse = z.infer<typeof TradfiVolHistoryResponseSchema>;
