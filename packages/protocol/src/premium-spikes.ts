import { z } from 'zod';
import { VenueIdSchema } from './ws.js';

export const PremiumSpikeQuerySchema = z.object({
  underlying: z.enum(['BTC', 'ETH']).default('BTC'),
  venue: VenueIdSchema.default('deribit'),
});
export const PREMIUM_SPIKE_TENORS = ['1M', '3M', '6M', '1Y'] as const;
export const PremiumSpikeTenorSchema = z.enum(PREMIUM_SPIKE_TENORS);
const PairSchema = z.object({ bid: z.number().finite(), ask: z.number().finite() });
const IvPairSchema = z.object({
  bid: z.number().finite().positive(),
  ask: z.number().finite().positive(),
});
const MoneyPairSchema = IvPairSchema.refine((pair) => pair.bid <= pair.ask);
export const PremiumSpikeMoneySchema = z.object({
  referencePriceUsd: z.number().finite().positive().nullable(),
  putPremiumUsdPerBase: MoneyPairSchema.nullable(),
  callPremiumUsdPerBase: MoneyPairSchema.nullable(),
});
export const PremiumSpikeSampleSchema = z.object({
  observedAt: z.number().int().nonnegative(),
  quoteAt: z.number().int().nonnegative(),
  putIv: IvPairSchema,
  callIv: IvPairSchema,
  putSkew: PairSchema,
  callSkew: PairSchema,
  money: PremiumSpikeMoneySchema.nullable().default(null),
});
export const PremiumSpikeTenorStateSchema = z.object({
  tenor: PremiumSpikeTenorSchema,
  targetDays: z.number().positive(),
  expiry: z.string().nullable(),
  expiryTs: z.number().nullable(),
  trackingSince: z.number().nullable(),
  sample: PremiumSpikeSampleSchema.nullable(),
  putHigh: PairSchema.nullable(),
  callHigh: PairSchema.nullable(),
});
export const PremiumSpikeAlertSchema = z.object({
  id: z.string(),
  timestamp: z.number().int().nonnegative(),
  tenor: PremiumSpikeTenorSchema,
  expiry: z.string(),
  expiryTs: z.number(),
  side: z.enum(['put', 'call']),
  previousHigh: PairSchema,
  sample: PremiumSpikeSampleSchema,
});
export const PremiumSpikeResponseSchema = z.object({
  underlying: z.enum(['BTC', 'ETH']),
  venue: VenueIdSchema,
  delta: z.literal(0.25),
  timeZone: z.literal('America/Los_Angeles'),
  sessionStartMs: z.number(),
  sessionEndMs: z.number(),
  monitorStartedAt: z.number(),
  lastScanAt: z.number().nullable(),
  error: z.string().nullable(),
  tenors: z.array(PremiumSpikeTenorStateSchema).length(4),
  alerts: z.array(PremiumSpikeAlertSchema).max(500),
  alertCount: z.number().int().nonnegative(),
});
export const PremiumSpikeHistorySchema = z.array(PremiumSpikeResponseSchema).max(8);
export type PremiumSpikeQuery = z.infer<typeof PremiumSpikeQuerySchema>;
export type PremiumSpikeSample = z.infer<typeof PremiumSpikeSampleSchema>;
export type PremiumSpikeTenorState = z.infer<typeof PremiumSpikeTenorStateSchema>;
export type PremiumSpikeAlert = z.infer<typeof PremiumSpikeAlertSchema>;
export type PremiumSpikeResponse = z.infer<typeof PremiumSpikeResponseSchema>;
