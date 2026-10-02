import { z } from 'zod';

import { VolRichnessSchema } from './vol-richness.js';

const NullableNumberSchema = z.number().nullable();

export const AlphaMarketContextQuerySchema = z.object({
  underlying: z.string().trim().min(2).max(20).transform((value) => value.toUpperCase()),
});

export type AlphaMarketContextQuery = z.infer<typeof AlphaMarketContextQuerySchema>;

export const AlphaExpectedMoveSchema = z.object({
  days: z.number(),
  iv: NullableNumberSchema,
  moveUsd: NullableNumberSchema,
  movePct: NullableNumberSchema,
});

export type AlphaExpectedMove = z.infer<typeof AlphaExpectedMoveSchema>;

export const AlphaRegimeSchema = z.object({
  dominant: z.enum(['low-vol', 'mid-vol', 'high-vol']).nullable(),
  direction: z.enum(['risk-on', 'neutral', 'risk-off']).nullable(),
  confidence: NullableNumberSchema,
  observationCount: z.number(),
});

export type AlphaRegime = z.infer<typeof AlphaRegimeSchema>;

export const AlphaMarketContextResponseSchema = z.object({
  generatedAt: z.number(),
  underlying: z.string(),
  spotPrice: NullableNumberSchema,
  volatility: z.object({
    state: z.enum(['compressed', 'normal', 'bid', 'unavailable']),
    // 'excess-premium': 30D IV against forecast plus usual premium; 'iv-percentile': fallback
    // to the 90-day IV percentile when the excess premium is unknown.
    stateSource: z.enum(['excess-premium', 'iv-percentile', 'unavailable']),
    atmIv7d: NullableNumberSchema,
    atmIv30d: NullableNumberSchema,
    ivPercentile7d: NullableNumberSchema,
    ivPercentile30d: NullableNumberSchema,
    ivChange1d: NullableNumberSchema,
    ivChange7d: NullableNumberSchema,
  }),
  realized: z.object({
    rv7d: NullableNumberSchema,
    rv30d: NullableNumberSchema,
    vrp7d: NullableNumberSchema,
    vrp30d: NullableNumberSchema,
  }),
  expectedMoves: z.array(AlphaExpectedMoveSchema),
  range: z.object({
    state: z.enum(['coiled', 'normal', 'expanded', 'unavailable']),
    width14dPct: NullableNumberSchema,
    width30dPct: NullableNumberSchema,
    percentile14d: NullableNumberSchema,
  }),
  spotState: z.object({
    state: z.enum(['inside-range', 'breaking-out', 'extended', 'unavailable']),
    direction: z.enum(['up', 'down']).nullable(),
    extensionPct: NullableNumberSchema,
  }),
  setup: z.object({
    longCall: z.enum(['favorable', 'watch', 'expensive', 'unavailable']),
    protectivePut: z.enum(['favorable', 'watch', 'expensive', 'unavailable']),
    creditSpread: z.enum(['favorable', 'watch', 'unfavorable', 'unavailable']),
  }),
  regime: AlphaRegimeSchema.nullable(),
  richness: VolRichnessSchema.nullable(),
  sources: z.object({
    ivHistory: z.boolean(),
    spotHistory: z.boolean(),
    regime: z.boolean(),
    ivScope: z.enum(['cross-venue', 'mixed']),
  }),
});

export type AlphaMarketContextResponse = z.infer<typeof AlphaMarketContextResponseSchema>;
