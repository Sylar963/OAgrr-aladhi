import { z } from 'zod';

import { VenueIdSchema } from './ws.js';

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
