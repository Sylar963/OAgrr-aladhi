import { z } from 'zod';

import {
  AlphaStraddleForecastSchema,
  AlphaStraddleScannerResponseSchema,
  NullableNumberSchema,
  VenueListSchema,
} from './alpha-straddle.js';
import { VenueIdSchema } from './ws.js';

export const AlphaLongStraddleScannerQuerySchema = z
  .object({
    underlying: z.string().trim().min(2).max(20).default('BTC').transform((value) => value.toUpperCase()),
    venues: VenueListSchema,
    minDte: z.coerce.number().min(0).max(365).default(1),
    maxDte: z.coerce.number().min(0).max(365).default(45),
    equity: z.coerce.number().positive().max(100_000_000).default(10_000),
    riskPct: z.coerce.number().positive().max(100).default(1),
    maxSpreadPct: z.coerce.number().positive().max(100).default(10),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((value) => value.maxDte >= value.minDte, {
    message: 'maxDte must be greater than or equal to minDte',
    path: ['maxDte'],
  });

export type AlphaLongStraddleScannerQuery = z.infer<typeof AlphaLongStraddleScannerQuerySchema>;

export const AlphaLongStraddleVerdictSchema = z.enum([
  'buy-candidate',
  'watch',
  'expensive',
  'no-forecast',
]);

export type AlphaLongStraddleVerdict = z.infer<typeof AlphaLongStraddleVerdictSchema>;

export const AlphaLongStraddleFlagSchema = z.enum([
  'iv_above_forecast',
  'edge_within_fair_band',
  'above_cone_median',
  'above_cone_p25',
  'cone_unavailable',
  'iv_far_below_realized',
  'term_backwardation',
  'theta_window',
  'size_below_minimum',
  'forecast_unavailable',
]);

export type AlphaLongStraddleFlag = z.infer<typeof AlphaLongStraddleFlagSchema>;

export const AlphaLongStraddleCandidateSchema = z.object({
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
  grossDebit: z.number(),
  netDebit: z.number(),
  combinedSpreadPct: z.number(),
  markIv: NullableNumberSchema,
  buyIv: z.number(),
  /** Forecast with the weekend share of the remaining life weighted at reduced variance. */
  forecastVol: NullableNumberSchema,
  calendarForecastVol: NullableNumberSchema,
  weekendShare: z.number(),
  realizedMatchedVol: NullableNumberSchema,
  /** Forecast minus buy IV: positive when the forecast expects more vol than the asks pay for. */
  volEdge: NullableNumberSchema,
  conePercentile: NullableNumberSchema,
  fairValueAtForecast: NullableNumberSchema,
  modelEdgeUsd: NullableNumberSchema,
  probOutsideAtForecast: NullableNumberSchema,
  breakevenLow: z.number(),
  breakevenHigh: z.number(),
  breakevenMovePct: z.number(),
  expectedMoveAtForecastPct: NullableNumberSchema,
  thetaUsdPerDay: z.number(),
  dailyBreakevenMovePct: z.number(),
  forecastDailyMovePct: NullableNumberSchema,
  netDelta: NullableNumberSchema,
  minQuantity: z.number(),
  quantityStep: z.number(),
  topOfBookQuantity: z.number(),
  riskBudgetQuantity: z.number(),
  suggestedQuantity: z.number(),
  edgePerDebit: NullableNumberSchema,
  verdict: AlphaLongStraddleVerdictSchema,
  flags: z.array(AlphaLongStraddleFlagSchema),
  asOfMs: z.number(),
});

export type AlphaLongStraddleCandidate = z.infer<typeof AlphaLongStraddleCandidateSchema>;

export const AlphaLongStraddleScannerResponseSchema = z.object({
  generatedAt: z.number(),
  underlying: z.string(),
  venues: z.array(VenueIdSchema),
  config: AlphaLongStraddleScannerQuerySchema,
  forecast: AlphaStraddleForecastSchema,
  context: AlphaStraddleScannerResponseSchema.shape.context,
  venueStatus: AlphaStraddleScannerResponseSchema.shape.venueStatus,
  candidates: z.array(AlphaLongStraddleCandidateSchema),
  skipped: z.record(z.number()),
});

export type AlphaLongStraddleScannerResponse = z.infer<typeof AlphaLongStraddleScannerResponseSchema>;
