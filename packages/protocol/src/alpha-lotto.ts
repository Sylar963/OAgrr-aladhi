import { z } from 'zod';

const NullableNumberSchema = z.number().nullable();

export const AlphaLottoScannerQuerySchema = z
  .object({
    premiumCap: z.coerce.number().positive().max(10_000).default(400),
    minDte: z.coerce.number().min(0).max(365).default(4),
    maxDte: z.coerce.number().min(0).max(365).default(14),
    minOtmPct: z.coerce.number().min(0).max(200).default(5),
    maxOtmPct: z.coerce.number().min(0).max(500).default(50),
    buyingPower: z.coerce.number().positive().max(10_000_000).default(2_400),
    marginHaircut: z.coerce.number().min(1).max(3).default(1.2),
    maxSpreadPct: z.coerce.number().positive().max(500).default(50),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .refine((value) => value.maxDte >= value.minDte, {
    message: 'maxDte must be greater than or equal to minDte',
    path: ['maxDte'],
  })
  .refine((value) => value.maxOtmPct >= value.minOtmPct, {
    message: 'maxOtmPct must be greater than or equal to minOtmPct',
    path: ['maxOtmPct'],
  });

export type AlphaLottoScannerQuery = z.infer<typeof AlphaLottoScannerQuerySchema>;

export const AlphaLottoTargetSchema = z.object({
  multiple: z.number(),
  targetMark: z.number(),
  intrinsicBtcPrice: z.number(),
  intrinsicMovePct: z.number(),
  black76BtcPrice: NullableNumberSchema,
  black76MovePct: NullableNumberSchema,
});

export type AlphaLottoTarget = z.infer<typeof AlphaLottoTargetSchema>;

export const AlphaLottoShockSchema = z.object({
  movePct: z.number(),
  btcPrice: z.number(),
  intrinsicValue: z.number(),
  intrinsicMultiple: z.number(),
});

export type AlphaLottoShock = z.infer<typeof AlphaLottoShockSchema>;

export const AlphaLottoCandidateSchema = z.object({
  instrument: z.string(),
  expiry: z.string(),
  expiryTs: z.number(),
  dte: z.number(),
  strike: z.number(),
  mark: z.number(),
  bid: z.number(),
  ask: z.number(),
  bidSize: NullableNumberSchema,
  askSize: NullableNumberSchema,
  delta: NullableNumberSchema,
  markIv: NullableNumberSchema,
  spreadPct: z.number(),
  otmPct: z.number(),
  breakEvenPrice: z.number(),
  breakEvenMovePct: z.number(),
  contractsAtMark: z.number(),
  contractsAtAsk: z.number(),
  conservativeContracts: z.number(),
  targets: z.array(AlphaLottoTargetSchema),
  shocks: z.array(AlphaLottoShockSchema),
  asOfMs: z.number(),
});

export type AlphaLottoCandidate = z.infer<typeof AlphaLottoCandidateSchema>;

export const AlphaLottoScannerResponseSchema = z.object({
  generatedAt: z.number(),
  venue: z.literal('thalex'),
  underlying: z.literal('BTC'),
  indexPrice: NullableNumberSchema,
  forwardPrice: NullableNumberSchema,
  eligibleExpiries: z.array(z.string()),
  config: AlphaLottoScannerQuerySchema,
  candidates: z.array(AlphaLottoCandidateSchema),
  skipped: z.record(z.number()),
});

export type AlphaLottoScannerResponse = z.infer<typeof AlphaLottoScannerResponseSchema>;
