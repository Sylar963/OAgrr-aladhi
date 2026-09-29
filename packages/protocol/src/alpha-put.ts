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

const QueryBooleanSchema = z.preprocess(
  (value) => value === 'true' ? true : value === 'false' ? false : value,
  z.boolean().default(false),
);

export const AlphaPutRankBySchema = z.enum(['protection', 'convexity']);
export type AlphaPutRankBy = z.infer<typeof AlphaPutRankBySchema>;

export const AlphaPutScannerQuerySchema = z
  .object({
    underlying: z.string().trim().min(2).max(20).default('BTC').transform((value) => value.toUpperCase()),
    venues: VenueListSchema,
    premiumCap: z.coerce.number().positive().max(100_000).default(10_000),
    minDte: z.coerce.number().min(0).max(365).default(7),
    maxDte: z.coerce.number().min(0).max(365).default(90),
    minOtmPct: z.coerce.number().min(0).max(95).default(0),
    maxOtmPct: z.coerce.number().min(0).max(95).default(30),
    hedgeQty: z.coerce.number().min(0).max(100_000).default(0),
    buyingPower: z.coerce.number().positive().max(10_000_000).default(2_400),
    marginHaircut: z.coerce.number().min(1).max(3).default(1.2),
    maxSpreadPct: z.coerce.number().positive().max(500).default(40),
    rankBy: AlphaPutRankBySchema.default('protection'),
    limit: z.coerce.number().int().min(1).max(60).default(20),
    diversifyExpiries: QueryBooleanSchema,
  })
  .refine((value) => value.maxDte >= value.minDte, {
    message: 'maxDte must be greater than or equal to minDte',
    path: ['maxDte'],
  })
  .refine((value) => value.maxOtmPct >= value.minOtmPct, {
    message: 'maxOtmPct must be greater than or equal to minOtmPct',
    path: ['maxOtmPct'],
  });

export type AlphaPutScannerQuery = z.infer<typeof AlphaPutScannerQuerySchema>;

export const AlphaPutTargetSchema = z.object({
  multiple: z.number(),
  targetMark: z.number(),
  intrinsicUnderlyingPrice: NullableNumberSchema,
  intrinsicMovePct: NullableNumberSchema,
  modelUnderlyingPrice: NullableNumberSchema,
  modelMovePct: NullableNumberSchema,
  impliedMoveMultiple: NullableNumberSchema,
});

export type AlphaPutTarget = z.infer<typeof AlphaPutTargetSchema>;

export const AlphaPutShockSchema = z.object({
  movePct: z.number(),
  underlyingPrice: z.number(),
  intrinsicValue: z.number(),
  intrinsicMultiple: z.number(),
});

export type AlphaPutShock = z.infer<typeof AlphaPutShockSchema>;

// Per-unit protection economics against one unit of underlying held at indexPrice.
export const AlphaPutProtectionSchema = z.object({
  premiumPerUnit: z.number(),
  costPct: z.number(),
  annualizedCostPct: z.number(),
  maxLossPct: z.number(),
  upsideBreakEvenPrice: z.number(),
  skewPremium: NullableNumberSchema,
});

export type AlphaPutProtection = z.infer<typeof AlphaPutProtectionSchema>;

export const AlphaPutHedgeSchema = z.object({
  targetQty: z.number(),
  contracts: z.number(),
  coveredQty: z.number(),
  cost: z.number(),
  costPctOfHolding: z.number(),
  maxLoss: z.number(),
  maxLossPct: z.number(),
  fullyCovered: z.boolean(),
});

export type AlphaPutHedge = z.infer<typeof AlphaPutHedgeSchema>;

export const AlphaPutCandidateSchema = z.object({
  venue: VenueIdSchema,
  underlying: z.string(),
  instrument: z.string(),
  settle: z.string(),
  inverse: z.boolean(),
  contractSize: z.number(),
  minQty: z.number(),
  expiry: z.string(),
  expiryTs: z.number(),
  dte: z.number(),
  strike: z.number(),
  indexPrice: z.number(),
  forwardPrice: z.number(),
  referenceSource: z.enum(['venue-forward', 'spot-proxy']),
  atmIv: NullableNumberSchema,
  expectedMoveUsd: NullableNumberSchema,
  expectedMovePct: NullableNumberSchema,
  mark: z.number(),
  bid: z.number(),
  ask: z.number(),
  takerFee: NullableNumberSchema,
  entryCost: z.number(),
  bidSize: NullableNumberSchema,
  askSize: NullableNumberSchema,
  delta: NullableNumberSchema,
  markIv: NullableNumberSchema,
  spreadPct: z.number(),
  /** Distance of the strike below the index, positive for OTM puts. */
  otmPct: z.number(),
  breakEvenPrice: z.number(),
  /** Signed move to breakeven; negative means the underlying must fall. */
  breakEvenMovePct: z.number(),
  minimumOrderCost: z.number(),
  quantityAtMark: z.number(),
  quantityAtAsk: z.number(),
  conservativeQuantity: z.number(),
  targets: z.array(AlphaPutTargetSchema),
  shocks: z.array(AlphaPutShockSchema),
  protection: AlphaPutProtectionSchema,
  hedge: AlphaPutHedgeSchema.nullable(),
  asOfMs: z.number(),
});

export type AlphaPutCandidate = z.infer<typeof AlphaPutCandidateSchema>;

export const AlphaPutScannerResponseSchema = z.object({
  generatedAt: z.number(),
  venues: z.array(VenueIdSchema),
  underlying: z.string(),
  indexPrice: NullableNumberSchema,
  forwardPrice: NullableNumberSchema,
  eligibleExpiries: z.array(z.string()),
  venueStatus: z.array(z.object({
    venue: VenueIdSchema,
    eligibleExpiries: z.number(),
    scannedContracts: z.number(),
    error: z.string().nullable(),
  })),
  config: AlphaPutScannerQuerySchema,
  candidates: z.array(AlphaPutCandidateSchema),
  skipped: z.record(z.number()),
});

export type AlphaPutScannerResponse = z.infer<typeof AlphaPutScannerResponseSchema>;
