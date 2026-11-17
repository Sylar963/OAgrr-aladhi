import { z } from 'zod';

const Value = z.number().finite().nonnegative().nullable();
const Count = z.number().int().nonnegative();

export const OptionsActivitySideSchema = z.object({
  contracts: Count,
  volumeObserved: Count,
  oiObserved: Count,
  volume: Value,
  openInterest: Value,
  volumeNotionalUsd: Value,
  oiNotionalUsd: Value,
});

export const OptionsActivitySchema = z.object({
  call: OptionsActivitySideSchema,
  put: OptionsActivitySideSchema,
  putCallVolumeRatio: Value,
  putCallOiRatio: Value,
});

export const OptionsActivityCellSchema = OptionsActivitySchema.extend({
  expiry: z.string(),
  strike: z.number().finite().positive(),
});

export const TradfiAnalyticsResponseSchema = z.object({
  underlying: z.string(),
  asOf: z.number(),
  sessionDate: z.string().nullable(),
  lastVolumeAt: z.number().nullable(),
  lastOiAt: z.number().nullable(),
  spot: Value,
  streaming: z.boolean(),
  expiries: z.array(z.string()),
  deferredExpiries: z.array(z.string()),
  summary: OptionsActivitySchema,
  byExpiry: z.array(OptionsActivitySchema.extend({ expiry: z.string(), dte: z.number() })),
  byStrike: z.array(OptionsActivitySchema.extend({ strike: z.number() })),
  cells: z.array(OptionsActivityCellSchema),
});

export const ParityStatusSchema = z.enum([
  'ok',
  'missing_pair',
  'invalid_quote',
  'missing_time',
  'stale',
  'unsynchronized',
]);

export const OptionsParityRowSchema = z.object({
  root: z.string(),
  strike: z.number(),
  multiplier: z.number(),
  status: ParityStatusSchema,
  callMinusPutBid: z.number().nullable(),
  callMinusPutAsk: z.number().nullable(),
  zeroRateForward: z.number().nullable(),
  quoteAgeMs: Value,
  quoteSkewMs: Value,
  bidSize: Value,
  askSize: Value,
  referenceStrikes: z.tuple([z.number(), z.number()]).nullable(),
  consistencyResidual: z.number().nullable(),
  consistencyLow: z.number().nullable(),
  consistencyHigh: z.number().nullable(),
});

export const TradfiParityResponseSchema = z.object({
  underlying: z.string(),
  expiry: z.string(),
  asOf: z.number(),
  streaming: z.boolean(),
  deferred: z.boolean(),
  europeanConsistency: z.boolean(),
  maxQuoteAgeMs: z.number(),
  maxQuoteSkewMs: z.number(),
  rows: z.array(OptionsParityRowSchema),
});

export type OptionsActivitySide = z.infer<typeof OptionsActivitySideSchema>;
export type OptionsActivity = z.infer<typeof OptionsActivitySchema>;
export type OptionsActivityCell = z.infer<typeof OptionsActivityCellSchema>;
export type TradfiAnalyticsResponse = z.infer<typeof TradfiAnalyticsResponseSchema>;
export type OptionsParityRow = z.infer<typeof OptionsParityRowSchema>;
export type TradfiParityResponse = z.infer<typeof TradfiParityResponseSchema>;
