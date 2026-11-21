import { z } from 'zod';
import { VenueExecutionQuoteSchema, VenueHealthDetailsSchema, VenueIdSchema } from './ws.js';

export const BotDepthQuerySchema = z.object({
  venue: VenueIdSchema,
  underlying: z.string().regex(/^[A-Z0-9_]{2,20}$/),
  expiry: z.string().date(),
  instrument: z.string().regex(/^[A-Z0-9_.-]{1,128}$/),
  levels: z.coerce.number().int().min(1).max(20).default(20),
  access: z.enum(['api', 'interactive']).default('api'),
  maxAgeMs: z.coerce.number().int().min(100).max(60000).default(5000),
});
export type BotDepthQuery = z.infer<typeof BotDepthQuerySchema>;

const LevelSchema = z.object({
  nativePrice: z.number().finite().positive(),
  nativeQuantity: z.number().finite().positive(),
  priceUsdPerBase: z.number().finite().positive().nullable(),
  quantityBase: z.number().finite().positive(),
});
export const BotDepthContractSchema = VenueExecutionQuoteSchema.pick({
  exchangeSymbol: true,
  settleCurrency: true,
  inverse: true,
  contractMultiplierBase: true,
  nativeMinQuantity: true,
  nativeQuantityStep: true,
  nativePriceTick: true,
  minQuantity: true,
  quantityStep: true,
  minNotionalUsd: true,
  expiryTs: true,
});
export const BotDepthResponseSchema = z.object({
  venue: VenueIdSchema,
  underlying: z.string(),
  expiry: z.string(),
  instrument: z.string(),
  generatedAt: z.number(),
  requestedAt: z.number(),
  receivedAt: z.number(),
  bookAgeMs: z.number(),
  source: z.enum(['rest', 'websocket-snapshot']),
  access: z.enum(['api', 'interactive']),
  dataMode: z.literal('snapshot'),
  exchangeTs: z.number().nullable(),
  exchangeTimestampBasis: z.enum(['generation', 'last-change', 'not-provided']),
  lastChangeAt: z.number().nullable(),
  sequence: z.string().nullable(),
  connectionGeneration: z.number().nullable(),
  sequenceContinuityVerified: z.literal(false),
  sourceMaxLevels: z.number(),
  requestedLevels: z.number(),
  depthLimited: z.literal(true),
  bookState: z.enum(['two-sided', 'one-sided', 'empty', 'crossed']),
  venueHealth: VenueHealthDetailsSchema.nullable().optional(),
  dataReady: z.boolean(),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  nativePriceCurrency: z.string(),
  nativeQuantityUnit: z.literal('venue-native'),
  normalization: z.object({
    priceUnit: z.literal('USD per base unit'),
    quantityUnit: z.literal('base'),
    priceBasis: z.enum(['inverse-index', 'usd', 'stablecoin-parity']),
    referencePriceUsd: z.number().nullable(),
    referenceAsOfMs: z.number().nullable(),
  }),
  contract: BotDepthContractSchema,
  bids: z.array(LevelSchema),
  asks: z.array(LevelSchema),
});
export type BotDepthResponse = z.infer<typeof BotDepthResponseSchema>;
