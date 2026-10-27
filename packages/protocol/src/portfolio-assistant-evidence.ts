import { z } from 'zod';
import { PortfolioSourceSchema } from './portfolio.js';

export const PortfolioAssistantIntentSchema = z.enum(['portfolio', 'exposure', 'accounting', 'theory', 'comparison']);
export type PortfolioAssistantIntent = z.infer<typeof PortfolioAssistantIntentSchema>;

export const PortfolioAssistantProgressSchema = z.enum([
  'loading_portfolio', 'checking_quotes', 'loading_history', 'evaluating_structures', 'searching_books', 'writing_answer',
]);
export type PortfolioAssistantProgress = z.infer<typeof PortfolioAssistantProgressSchema>;

export const PortfolioAssistantActionSchema = z.enum(['positions', 'scenario', 'alternatives']);
export type PortfolioAssistantAction = z.infer<typeof PortfolioAssistantActionSchema>;

export const PortfolioAssistantSnapshotSchema = z.object({
  generatedAt: z.number().int().nonnegative(),
  source: PortfolioSourceSchema,
  underlying: z.string().nullable(),
  network: z.enum(['mainnet', 'testnet']).nullable(),
  forwardDays: z.number().int().nonnegative(),
  dataState: z.enum(['fresh', 'partial', 'stale']),
  spotUsd: z.number().nullable(),
  unrealizedPnlUsd: z.number().nullable(),
  netDeltaCoin: z.number().nullable(),
  netThetaUsd: z.number().nullable(),
  netVegaUsd: z.number().nullable(),
  equityUsd: z.number().nullable(),
  openLegCount: z.number().int().nonnegative(),
  positions: z.array(z.object({
    legId: z.string(),
    underlying: z.string(),
    expiry: z.string(),
    strike: z.number(),
    optionRight: z.enum(['call', 'put']),
    size: z.number(),
    markUsd: z.number().nullable(),
    markUpdatedAt: z.number().int().nonnegative().nullable(),
  })).max(100),
  positionsTruncated: z.boolean(),
});
export type PortfolioAssistantSnapshot = z.infer<typeof PortfolioAssistantSnapshotSchema>;

export const PortfolioAssistantComparisonSchema = z.object({
  previousGeneratedAt: z.number().int().nonnegative(),
  changes: z.array(z.object({
    metric: z.enum(['spotUsd', 'unrealizedPnlUsd', 'netDeltaCoin', 'netThetaUsd', 'netVegaUsd', 'equityUsd']),
    previous: z.number().nullable(),
    current: z.number().nullable(),
    change: z.number().nullable(),
  })),
  positionChanges: z.array(z.object({
    legId: z.string(),
    instrument: z.string(),
    previousSize: z.number(),
    currentSize: z.number(),
  })).max(200),
  positionsComparable: z.boolean(),
});
export type PortfolioAssistantComparison = z.infer<typeof PortfolioAssistantComparisonSchema>;

export const PortfolioAssistantEvidenceSchema = z.object({
  version: z.literal(1),
  intent: PortfolioAssistantIntentSchema,
  snapshot: PortfolioAssistantSnapshotSchema,
  contextSections: z.array(z.enum(['portfolio', 'scenarios', 'market', 'trades', 'account'])),
  relevantLegIds: z.array(z.string()).max(100),
  assumptions: z.array(z.enum([
    'mark_not_execution', 'constant_iv_scenarios', 'expiry_not_margin', 'snapshot_not_quote_time',
    'changes_not_attribution', 'risk_neutral_not_forecast',
  ])),
  gaps: z.array(z.string()),
  actions: z.array(PortfolioAssistantActionSchema),
  comparison: PortfolioAssistantComparisonSchema.nullable(),
});
export type PortfolioAssistantEvidence = z.infer<typeof PortfolioAssistantEvidenceSchema>;
