import { z } from 'zod';

import { NullableNumberSchema, VenueListSchema } from './alpha-straddle.js';
import { VenueIdSchema } from './ws.js';

export const AlphaIronFlyScannerQuerySchema = z
  .object({
    underlying: z.string().trim().min(2).max(20).default('BTC').transform((value) => value.toUpperCase()),
    venues: VenueListSchema,
    minDte: z.coerce.number().min(0).max(365).default(0),
    maxDte: z.coerce.number().min(0).max(365).default(7),
    equity: z.coerce.number().positive().max(100_000_000).default(10_000),
    riskPct: z.coerce.number().positive().max(100).default(1),
    maxSpreadPct: z.coerce.number().positive().max(500).default(40),
    lookbackWeeks: z.coerce.number().int().min(78).max(312).default(156),
    limit: z.coerce.number().int().min(1).max(80).default(40),
  })
  .refine((value) => value.maxDte >= value.minDte, {
    message: 'maxDte must be greater than or equal to minDte',
    path: ['maxDte'],
  });

export type AlphaIronFlyScannerQuery = z.infer<typeof AlphaIronFlyScannerQuerySchema>;

export const AlphaIronFlyVerdictSchema = z.enum([
  'historically-positive',
  'watch',
  'historically-negative',
  'thin-history',
]);

export type AlphaIronFlyVerdict = z.infer<typeof AlphaIronFlyVerdictSchema>;

export const AlphaIronFlyFlagSchema = z.enum([
  'fit_mean_negative',
  'holdout_mean_negative',
  'ci_includes_zero',
  'thin_history',
  'overlapping_windows',
  'size_below_minimum',
]);

export type AlphaIronFlyFlag = z.infer<typeof AlphaIronFlyFlagSchema>;

/** Expiry P&L of one fly (per underlying unit, USD) over a set of past comparable windows. */
export const AlphaIronFlyHistoryStatsSchema = z.object({
  n: z.number().int().nonnegative(),
  /** n scaled down when windows are longer than a week and overlap. */
  independentN: z.number().nonnegative(),
  profitRate: NullableNumberSchema,
  meanPnl: NullableNumberSchema,
  ciLow: NullableNumberSchema,
  ciHigh: NullableNumberSchema,
  worstPnl: NullableNumberSchema,
  bestPnl: NullableNumberSchema,
});

export type AlphaIronFlyHistoryStats = z.infer<typeof AlphaIronFlyHistoryStatsSchema>;

export const AlphaIronFlyCandidateSchema = z.object({
  venue: VenueIdSchema,
  underlying: z.string(),
  expiry: z.string(),
  expiryTs: z.number(),
  dte: z.number(),
  center: z.number(),
  width: z.number(),
  forwardPrice: z.number(),
  callInstrument: z.string(),
  putInstrument: z.string(),
  wingCallInstrument: z.string(),
  wingPutInstrument: z.string(),
  callBid: z.number(),
  putBid: z.number(),
  wingCallAsk: z.number(),
  wingPutAsk: z.number(),
  entryFees: z.number(),
  grossCredit: z.number(),
  /** Credit after taker fees on all four legs; settlement fees are not included. */
  netCredit: z.number(),
  maxLoss: z.number(),
  breakevenLow: z.number(),
  breakevenHigh: z.number(),
  /** Half-width of the profit zone as a share of the forward, in percent. */
  profitZonePct: z.number(),
  combinedSpreadPct: z.number(),
  markIv: NullableNumberSchema,
  /** Lognormal probability of settling inside the breakevens at the body's mark IV. */
  impliedProfitRate: NullableNumberSchema,
  /** Older windows: used for ranking and the verdict. */
  fit: AlphaIronFlyHistoryStatsSchema,
  /** Most recent windows, kept out of ranking. */
  holdout: AlphaIronFlyHistoryStatsSchema,
  all: AlphaIronFlyHistoryStatsSchema,
  /** Fit-sample mean P&L divided by max loss. */
  fitEvPerMaxLoss: NullableNumberSchema,
  netDelta: NullableNumberSchema,
  minQuantity: z.number(),
  quantityStep: z.number(),
  topOfBookQuantity: z.number(),
  riskBudgetQuantity: z.number(),
  suggestedQuantity: z.number(),
  verdict: AlphaIronFlyVerdictSchema,
  flags: z.array(AlphaIronFlyFlagSchema),
  asOfMs: z.number(),
});

export type AlphaIronFlyCandidate = z.infer<typeof AlphaIronFlyCandidateSchema>;

/** Past windows ending at the same weekday and hour as this expiry, oldest first. */
export const AlphaIronFlyWindowSetSchema = z.object({
  expiryTs: z.number(),
  horizonHours: z.number(),
  startTs: z.array(z.number()),
  /** Settlement-hour price ÷ entry-hour price for each window. */
  ratios: z.array(z.number()),
  /** Index of the first holdout window; earlier windows form the fit sample. */
  holdoutFrom: z.number().int().nonnegative(),
});

export type AlphaIronFlyWindowSet = z.infer<typeof AlphaIronFlyWindowSetSchema>;

export const AlphaIronFlyScannerResponseSchema = z.object({
  generatedAt: z.number(),
  underlying: z.string(),
  venues: z.array(VenueIdSchema),
  config: AlphaIronFlyScannerQuerySchema,
  history: z.object({
    source: z.string(),
    available: z.boolean(),
    holdoutWeeks: z.number().int(),
    firstCandleTs: NullableNumberSchema,
  }),
  windows: z.array(AlphaIronFlyWindowSetSchema),
  venueStatus: z.array(
    z.object({
      venue: VenueIdSchema,
      eligibleExpiries: z.number().int().nonnegative(),
      error: z.string().nullable(),
    }),
  ),
  candidates: z.array(AlphaIronFlyCandidateSchema),
  skipped: z.record(z.number()),
});

export type AlphaIronFlyScannerResponse = z.infer<typeof AlphaIronFlyScannerResponseSchema>;
