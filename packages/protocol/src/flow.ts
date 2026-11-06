import { z } from 'zod';

import { VenueIdSchema } from './ws.js';
import { ExchangeTradeEvidenceSchema, FlowAnalysisSchema } from './flow-evidence.js';

export const FlowTradeSchema = z.object({
  venue: VenueIdSchema,
  tradeUid: z.string().min(1),
  tradeId: z.string().nullable(),
  instrument: z.string().min(1),
  underlying: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  price: z.number(),
  size: z.number(),
  iv: z.number().nullable(),
  markPrice: z.number().nullable(),
  indexPrice: z.number().nullable(),
  premiumUsd: z.number().nullable(),
  notionalUsd: z.number().nullable(),
  referencePriceUsd: z.number().nullable(),
  isBlock: z.boolean(),
  timestamp: z.number(),
  exchangeEvidence: ExchangeTradeEvidenceSchema.optional(),
  analysis: FlowAnalysisSchema.optional(),
});

export type FlowTrade = z.infer<typeof FlowTradeSchema>;

export const FlowTradeHistoryCursorSchema = z.object({
  beforeTs: z.string(),
  beforeUid: z.string(),
});

export type FlowTradeHistoryCursor = z.infer<typeof FlowTradeHistoryCursorSchema>;

export const InstrumentTradesResponseSchema = z.object({
  available: z.boolean(),
  trades: z.array(FlowTradeSchema),
  nextCursor: FlowTradeHistoryCursorSchema.nullable(),
});

export type InstrumentTradesResponse = z.infer<typeof InstrumentTradesResponseSchema>;

export const FlowStrikeMapBucketSchema = z.object({
  bucketTs: z.number(),
  instrument: z.string().min(1),
  expiry: z.string().min(1),
  strike: z.number().positive(),
  optionType: z.enum(['call', 'put']),
  side: z.enum(['buy', 'sell']),
  count: z.number().int().positive(),
  contracts: z.number().nonnegative(),
  premiumUsd: z.number().nonnegative(),
  notionalUsd: z.number().nonnegative(),
});
export type FlowStrikeMapBucket = z.infer<typeof FlowStrikeMapBucketSchema>;

export const FlowStrikeMapIvPointSchema = z.object({
  instrument: z.string().min(1),
  strike: z.number().positive(),
  optionType: z.enum(['call', 'put']),
  iv: z.number().nonnegative().nullable(),
  observedAt: z.number().nullable(),
  count: z.number().int().positive(),
});
export type FlowStrikeMapIvPoint = z.infer<typeof FlowStrikeMapIvPointSchema>;

export const FlowStrikeMapPointSchema = z.object({
  bucketTs: z.number(),
  optionType: z.enum(['call', 'put']),
  side: z.enum(['buy', 'sell']),
  count: z.number().int().positive(),
  contracts: z.number().nonnegative(),
  notionalUsd: z.number().nonnegative(),
});
export type FlowStrikeMapPoint = z.infer<typeof FlowStrikeMapPointSchema>;

export const FlowStrikeMapResponseSchema = z.object({
  available: z.boolean(),
  underlying: z.string(),
  venue: VenueIdSchema,
  expiry: z.string(),
  start: z.number(),
  end: z.number(),
  resolution: z.number().positive(),
  count: z.number().nonnegative(),
  premiumUsd: z.number().nonnegative(),
  notionalUsd: z.number().nonnegative(),
  buyNotionalUsd: z.number().nonnegative(),
  sellNotionalUsd: z.number().nonnegative(),
  points: z.array(FlowStrikeMapPointSchema),
  buckets: z.array(FlowStrikeMapBucketSchema),
  ivPoints: z.array(FlowStrikeMapIvPointSchema),
  ivCoverageComplete: z.boolean(),
});
export type FlowStrikeMapResponse = z.infer<typeof FlowStrikeMapResponseSchema>;

export const InstrumentTradeWsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    generatedAt: z.number(),
    trades: z.array(FlowTradeSchema),
  }),
  z.object({
    type: z.literal('trade'),
    trade: FlowTradeSchema,
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);

export type InstrumentTradeWsServerMessage = z.infer<typeof InstrumentTradeWsServerMessageSchema>;

export const CALL_PUT_FLOW_RESOLUTIONS = [900, 3600, 14400] as const;
export const CALL_PUT_FLOW_MAX_DAYS = 90;

/** Screen (non-institutional) flow per bucket; `ts` is the bucket start in epoch seconds. */
export const CallPutFlowBucketSchema = z.object({
  ts: z.number(),
  callCount: z.number(),
  putCount: z.number(),
  callContracts: z.number(),
  putContracts: z.number(),
  callNotionalUsd: z.number(),
  putNotionalUsd: z.number(),
  callPremiumUsd: z.number(),
  putPremiumUsd: z.number(),
});

export type CallPutFlowBucket = z.infer<typeof CallPutFlowBucketSchema>;

export const CallPutFlowResponseSchema = z.object({
  available: z.boolean(),
  underlying: z.string(),
  resolution: z.number(),
  start: z.number(),
  end: z.number(),
  buckets: z.array(CallPutFlowBucketSchema),
});

export type CallPutFlowResponse = z.infer<typeof CallPutFlowResponseSchema>;
