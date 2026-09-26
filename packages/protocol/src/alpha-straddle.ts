import { z } from 'zod';

import { VenueIdSchema } from './ws.js';

const NullableNumberSchema = z.number().nullable();

const VenueListSchema = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value.split(',').map((venue) => venue.trim()).filter(Boolean)
      : value,
  z.array(VenueIdSchema).min(1).default(['thalex']),
);

export const AlphaStraddleScannerQuerySchema = z
  .object({
    underlying: z.string().trim().min(2).max(20).default('BTC').transform((value) => value.toUpperCase()),
    venues: VenueListSchema,
    minDte: z.coerce.number().min(0).max(365).default(1),
    maxDte: z.coerce.number().min(0).max(365).default(45),
    equity: z.coerce.number().positive().max(100_000_000).default(10_000),
    riskPct: z.coerce.number().positive().max(100).default(1),
    stressSigma: z.coerce.number().min(1).max(6).default(3),
    maxSpreadPct: z.coerce.number().positive().max(100).default(10),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((value) => value.maxDte >= value.minDte, {
    message: 'maxDte must be greater than or equal to minDte',
    path: ['maxDte'],
  });

export type AlphaStraddleScannerQuery = z.infer<typeof AlphaStraddleScannerQuerySchema>;

export const AlphaStraddleVerdictSchema = z.enum(['sell-candidate', 'watch', 'cheap', 'no-forecast']);

export type AlphaStraddleVerdict = z.infer<typeof AlphaStraddleVerdictSchema>;

export const AlphaStraddleFlagSchema = z.enum([
  'iv_below_hurdle',
  'negative_model_edge',
  'below_cone_median',
  'below_cone_p75',
  'cone_unavailable',
  'premium_not_above_normal',
  'premium_baseline_unknown',
  'term_backwardation',
  'spot_breaking_out',
  'realized_accelerating',
  'gamma_window',
  'size_below_minimum',
  'forecast_unavailable',
]);

export type AlphaStraddleFlag = z.infer<typeof AlphaStraddleFlagSchema>;

export const AlphaStraddlePremiumBaselineSchema = z.object({
  tenorDays: z.number(),
  // 'venue': measured from this venue's own IV history. 'blended': cross-venue history, used
  // until the venue has enough independent windows of its own.
  source: z.enum(['venue', 'blended']),
  medianSpread: NullableNumberSchema,
  sampleCount: z.number().int().nonnegative(),
  independentSampleCount: z.number().int().nonnegative(),
});

export type AlphaStraddlePremiumBaseline = z.infer<typeof AlphaStraddlePremiumBaselineSchema>;

export const AlphaStraddleCandidateSchema = z.object({
  venue: VenueIdSchema,
  underlying: z.string(),
  callInstrument: z.string(),
  putInstrument: z.string(),
  expiry: z.string(),
  expiryTs: z.number(),
  dte: z.number(),
  strike: z.number(),
  forwardPrice: z.number(),
  callBid: z.number(),
  putBid: z.number(),
  callAsk: z.number(),
  putAsk: z.number(),
  entryFees: z.number(),
  grossCredit: z.number(),
  netCredit: z.number(),
  combinedSpreadPct: z.number(),
  markIv: NullableNumberSchema,
  sellIv: z.number(),
  forecastVol: NullableNumberSchema,
  realizedMatchedVol: NullableNumberSchema,
  hurdleVol: NullableNumberSchema,
  volEdge: NullableNumberSchema,
  excessEdge: NullableNumberSchema,
  conePercentile: NullableNumberSchema,
  premiumBaseline: AlphaStraddlePremiumBaselineSchema,
  fairValueAtForecast: NullableNumberSchema,
  modelEdgeUsd: NullableNumberSchema,
  probInsideAtForecast: NullableNumberSchema,
  breakevenLow: z.number(),
  breakevenHigh: z.number(),
  breakevenMovePct: z.number(),
  dailyBreakevenMovePct: z.number(),
  forecastDailyMovePct: NullableNumberSchema,
  netDelta: NullableNumberSchema,
  stressMovePct: z.number(),
  stressLossUsd: z.number(),
  minQuantity: z.number(),
  quantityStep: z.number(),
  topOfBookQuantity: z.number(),
  riskBudgetQuantity: z.number(),
  suggestedQuantity: z.number(),
  edgePerStress: NullableNumberSchema,
  verdict: AlphaStraddleVerdictSchema,
  flags: z.array(AlphaStraddleFlagSchema),
  asOfMs: z.number(),
});

export type AlphaStraddleCandidate = z.infer<typeof AlphaStraddleCandidateSchema>;

export const AlphaStraddleForecastSchema = z.object({
  method: z.literal('mean-reverting-realized-v1'),
  rv7d: NullableNumberSchema,
  rv30d: NullableNumberSchema,
  longRunVol: NullableNumberSchema,
  longRunDays: z.number().int().nonnegative(),
  halfLifeDays: z.number(),
});

export type AlphaStraddleForecast = z.infer<typeof AlphaStraddleForecastSchema>;

export const AlphaStraddleScannerResponseSchema = z.object({
  generatedAt: z.number(),
  underlying: z.string(),
  venues: z.array(VenueIdSchema),
  config: AlphaStraddleScannerQuerySchema,
  forecast: AlphaStraddleForecastSchema,
  context: z.object({
    atmIv7d: NullableNumberSchema,
    atmIv30d: NullableNumberSchema,
    ivPercentile30d: NullableNumberSchema,
    termStructure: z.enum(['contango', 'flat', 'backwardation', 'unknown']),
    spotState: z.enum(['inside-range', 'breaking-out', 'extended', 'unavailable']),
  }),
  venueStatus: z.array(z.object({
    venue: VenueIdSchema,
    eligibleExpiries: z.number(),
    error: z.string().nullable(),
  })),
  candidates: z.array(AlphaStraddleCandidateSchema),
  skipped: z.record(z.number()),
});

export type AlphaStraddleScannerResponse = z.infer<typeof AlphaStraddleScannerResponseSchema>;
