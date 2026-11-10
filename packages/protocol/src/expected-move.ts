import { z } from 'zod';
import { VenueIdSchema } from './ws.js';

export const ExpectedMoveAssetSchema = z.enum(['BTC', 'ETH', 'SPX']);
export const ExpectedMoveAnchorSchema = z.enum(['utc0', 'utc8', 'cash']);
export const ExpectedMoveQuerySchema = z
  .object({
    underlying: ExpectedMoveAssetSchema,
    anchor: ExpectedMoveAnchorSchema,
    days: z.coerce.number().int().min(1).max(30).default(14),
  })
  .refine((q) => (q.underlying === 'SPX') === (q.anchor === 'cash'), {
    message: 'SPX requires cash sessions; crypto requires a UTC anchor',
  });

const nullable = z.number().finite().nullable();
export const ExpectedMoveSessionSchema = z.object({
  startMs: z.number().int(),
  endMs: z.number().int(),
  open: z.number().positive(),
  last: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  priceAsOfMs: z.number().int(),
  openingIv: nullable,
  ivAsOfMs: z.number().int().nullable(),
  expectedFraction: nullable,
  expectedUsd: nullable,
  approximateStraddleUsd: nullable,
  lower: nullable,
  upper: nullable,
  returnFraction: z.number().finite(),
  absoluteReturnFraction: z.number().finite(),
  rangeFraction: z.number().finite(),
  moveRatio: nullable,
  complete: z.boolean(),
  coverage: z.enum(['complete', 'partial']),
  classification: z.enum(['large', 'small', 'at-benchmark', 'in-progress', 'unavailable']),
});

export const ExpectedMoveResponseSchema = z.object({
  underlying: ExpectedMoveAssetSchema,
  anchor: ExpectedMoveAnchorSchema,
  generatedAt: z.number().int(),
  periodsPerYear: z.union([z.literal(252), z.literal(365)]),
  index: z.enum(['DVOL', 'VIX']),
  priceSource: z.enum(['aggregated-spot', 'SPX-cash']),
  liveIv: nullable,
  liveIvAsOfMs: z.number().int().nullable(),
  current: ExpectedMoveSessionSchema.nullable(),
  history: z.array(ExpectedMoveSessionSchema),
});

export const ExpectedStraddleQuerySchema = z
  .object({
    underlying: ExpectedMoveAssetSchema,
    expiry: z.string().date(),
    venue: z.union([VenueIdSchema, z.literal('tastytrade')]),
  })
  .refine((q) => (q.underlying === 'SPX') === (q.venue === 'tastytrade'), {
    message: 'SPX requires tastytrade; crypto requires a crypto venue',
  });

export const ExpectedStraddleResponseSchema = z.object({
  underlying: ExpectedMoveAssetSchema,
  expiry: z.string(),
  venue: z.string(),
  generatedAt: z.number().int(),
  status: z.enum([
    'available',
    'missing-quotes',
    'stale-quotes',
    'missing-expiry',
    'missing-forward',
    'unavailable',
  ]),
  strike: nullable,
  forward: nullable,
  expiryTs: nullable,
  quoteAsOfMs: nullable,
  bid: nullable,
  ask: nullable,
  mid: nullable,
  bidSize: nullable,
  askSize: nullable,
  indexIv: nullable,
  indexModel: nullable,
  surfaceIv: nullable,
  surfaceModel: nullable,
  surfaceStrikes: z.array(z.number()),
  indexDifferenceFraction: nullable,
  surfaceDifferenceFraction: nullable,
});

export type ExpectedMoveAsset = z.infer<typeof ExpectedMoveAssetSchema>;
export type ExpectedMoveAnchor = z.infer<typeof ExpectedMoveAnchorSchema>;
export type ExpectedMoveQuery = z.infer<typeof ExpectedMoveQuerySchema>;
export type ExpectedMoveSession = z.infer<typeof ExpectedMoveSessionSchema>;
export type ExpectedMoveResponse = z.infer<typeof ExpectedMoveResponseSchema>;
export type ExpectedStraddleQuery = z.infer<typeof ExpectedStraddleQuerySchema>;
export type ExpectedStraddleResponse = z.infer<typeof ExpectedStraddleResponseSchema>;
