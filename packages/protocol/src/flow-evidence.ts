import { z } from 'zod';
import { VenueIdSchema } from './ws.js';

export const FlowEvidenceQuerySchema = z.object({
  mode: z.enum(['live', 'institutional']),
  tradeUid: z.string().min(1).max(300),
  venue: VenueIdSchema,
  underlying: z.string().min(1).max(30),
  instrument: z.string().min(1).max(200),
  timestamp: z.coerce.number().int().nonnegative().max(4_102_444_800_000),
});

export const ExchangeTradeEvidenceSchema = z.object({
  blockTradeId: z.string().min(1).optional(),
  rfqId: z.string().min(1).optional(),
  comboId: z.string().min(1).optional(),
  comboTradeId: z.string().min(1).optional(),
  expectedLegCount: z.number().int().positive().optional(),
  tradeSequence: z.string().min(1).optional(),
  liquidation: z.enum(['maker', 'taker', 'both']).optional(),
  impliedTaker: z.boolean().optional(),
  groupComplete: z.boolean().optional(),
});
export type ExchangeTradeEvidence = z.infer<typeof ExchangeTradeEvidenceSchema>;

export const FlowAnalysisLegSchema = z.object({
  instrument: z.string(),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().finite().positive(),
  expiry: z.string().nullable(),
  strike: z.number().nullable(),
  optionType: z.enum(['call', 'put']).nullable(),
});
export const FlowAnalysisSchema = z.object({
  structure: z.string(),
  linkage: z.enum(['exchange', 'unlinked']),
  completeness: z.enum(['complete', 'partial', 'unknown']),
  groupId: z.string().nullable(),
  executionSide: z.enum(['buy', 'sell', 'mixed']),
  sideBasis: z.enum(['taker', 'reported', 'legs']),
  positionEffect: z.literal('unknown'),
  legs: z.array(FlowAnalysisLegSchema),
  issues: z.array(z.string()),
});
export type FlowAnalysis = z.infer<typeof FlowAnalysisSchema>;
export type FlowAnalysisLeg = z.infer<typeof FlowAnalysisLegSchema>;

export const FlowOiContextSchema = z.object({
  instrument: z.string(),
  status: z.enum(['bracketed', 'gap', 'pending', 'unavailable']),
  before: z.object({ timestamp: z.number(), openInterest: z.number() }).nullable(),
  after: z.object({ timestamp: z.number(), openInterest: z.number() }).nullable(),
  delta: z.number().nullable(),
  intervalMs: z.number().nullable(),
  timing: z.literal('sampled'),
  tradeCoverage: z.literal('unverified'),
});
export type FlowOiContext = z.infer<typeof FlowOiContextSchema>;

export const FlowEvidenceResponseSchema = z.object({
  analysis: FlowAnalysisSchema,
  evidence: ExchangeTradeEvidenceSchema.nullable(),
  oi: z.array(FlowOiContextSchema),
});
export type FlowEvidenceResponse = z.infer<typeof FlowEvidenceResponseSchema>;
