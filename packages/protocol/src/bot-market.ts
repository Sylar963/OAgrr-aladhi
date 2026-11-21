import { z } from 'zod';
import { EnrichedChainResponseSchema, VenueHealthDetailsSchema, VenueIdSchema } from './ws.js';

export const BotMarketQuerySchema = z.object({
  underlying: z.string().regex(/^[A-Z0-9_]{2,20}$/),
  expiry: z.string().date(),
  venues: z
    .string()
    .min(1)
    .transform((value) => [...new Set(value.split(','))])
    .pipe(z.array(VenueIdSchema).min(1).max(9)),
  maxQuoteAgeMs: z.coerce.number().int().min(100).max(60_000).default(5000),
  maxSpreadPct: z.coerce.number().positive().max(1000).default(50),
  requireGreeks: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});
export type BotMarketQuery = z.infer<typeof BotMarketQuerySchema>;

export const BotQuoteQualitySchema = z.object({
  venue: VenueIdSchema,
  strike: z.number(),
  right: z.enum(['call', 'put']),
  exchangeSymbol: z.string().nullable(),
  asOfMs: z.number().nullable(),
  ageMs: z.number().nullable(),
  eligible: z.boolean(),
  reasons: z.array(z.string()),
  greekBasis: z.enum(['venue-or-adapter', 'black76-r0-derived-gamma-vega-theta']),
});
export const BotMarketResponseSchema = z.object({
  generatedAt: z.number(),
  dataReady: z.boolean(),
  thresholds: z.object({
    maxQuoteAgeMs: z.number(),
    maxSpreadPct: z.number(),
    requireGreeks: z.boolean(),
  }),
  units: z.object({
    price: z.literal('USD per base unit'),
    quantity: z.literal('base'),
    iv: z.literal('fraction'),
    feeBasis: z.literal('estimated-public-schedule'),
    executionFields: z.literal('chain.strikes[].call|put.venues[venue].execution'),
  }),
  chain: EnrichedChainResponseSchema,
  quality: z.array(BotQuoteQualitySchema),
  venues: z.array(
    z.object({
      venue: VenueIdSchema,
      quotes: z.number(),
      eligibleQuotes: z.number(),
      state: z.string(),
    }),
  ),
  venueHealth: z.array(VenueHealthDetailsSchema).optional(),
  failedVenues: z.array(z.object({ venue: VenueIdSchema, reason: z.string() })),
});
export type BotMarketResponse = z.infer<typeof BotMarketResponseSchema>;
