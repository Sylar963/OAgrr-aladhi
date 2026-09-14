import { z } from 'zod';

export const ShortStraddleEvaluationQuerySchema = z.object({
  underlying: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.toUpperCase() : value),
      z.enum(['BTC', 'ETH']),
    )
    .default('BTC'),
  windowDays: z.coerce.number().int().min(1).max(365).default(90),
  minimumSamples: z.coerce.number().int().min(10).max(1_000).default(100),
});

export type ShortStraddleEvaluationQuery = z.infer<typeof ShortStraddleEvaluationQuerySchema>;

export const ShortStraddleEvidenceStatusSchema = z.enum([
  'collecting',
  'insufficient_data',
  'evidence_available',
]);

export type ShortStraddleEvidenceStatus = z.infer<typeof ShortStraddleEvidenceStatusSchema>;

export const ShortStraddleEdgeAssessmentSchema = z.enum([
  'inconclusive',
  'positive_after_costs',
  'negative_after_costs',
]);

export type ShortStraddleEdgeAssessment = z.infer<typeof ShortStraddleEdgeAssessmentSchema>;

export const ShortStraddleEvaluationSegmentSchema = z.object({
  venue: z.string().min(1),
  underlying: z.enum(['BTC', 'ETH']),
  horizonHours: z.union([z.literal(1), z.literal(6), z.literal(24), z.literal(72)]),
  status: ShortStraddleEvidenceStatusSchema.exclude(['collecting']),
  assessment: ShortStraddleEdgeAssessmentSchema,
  eligibleCohortCount: z.number().int().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
  missingMarkCount: z.number().int().nonnegative(),
  markCoverageRate: z.number().min(0).max(1),
  independentSampleCount: z.number().int().nonnegative(),
  overlappingSampleCountExcluded: z.number().int().nonnegative(),
  profitableCount: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1),
  totalPnlUsdPerUnit: z.number().finite(),
  meanPnlUsdPerUnit: z.number().finite(),
  meanPnl95ConfidenceLowUsdPerUnit: z.number().finite().nullable(),
  meanPnl95ConfidenceHighUsdPerUnit: z.number().finite().nullable(),
  medianPnlUsdPerUnit: z.number().finite(),
  bestPnlUsdPerUnit: z.number().finite(),
  worstPnlUsdPerUnit: z.number().finite(),
  meanPnlPctOfGrossCredit: z.number().finite(),
  meanCommonTopOfBookQuantity: z.number().finite().nonnegative(),
  cumulativeUnitPnlMaxDrawdownUsd: z.number().finite().nonnegative(),
  firstCohortAt: z.string().datetime(),
  lastCohortAt: z.string().datetime(),
});

export type ShortStraddleEvaluationSegment = z.infer<
  typeof ShortStraddleEvaluationSegmentSchema
>;

export const ShortStraddleEvaluationResponseSchema = z.object({
  underlying: z.enum(['BTC', 'ETH']),
  windowDays: z.number().int().positive(),
  minimumSamples: z.number().int().positive(),
  status: ShortStraddleEvidenceStatusSchema,
  cohortCount: z.number().int().nonnegative(),
  eligibleSampleCount: z.number().int().nonnegative(),
  completedSampleCount: z.number().int().nonnegative(),
  missingMarkCount: z.number().int().nonnegative(),
  markCoverageRate: z.number().min(0).max(1).nullable(),
  dataThrough: z.string().datetime().nullable(),
  methodology: z.object({
    entry: z.literal('sell_call_and_put_at_executable_bids'),
    exit: z.literal('buy_call_and_put_at_executable_asks'),
    fees: z.literal('taker_fees_on_entry_and_exit'),
    horizonsHours: z.tuple([z.literal(1), z.literal(6), z.literal(24), z.literal(72)]),
    missedMarks: z.literal('excluded_without_backfill'),
    overlappingCohorts: z.literal('downsampled_for_statistics'),
    minimumMarkCoverage: z.literal(0.8),
    pnlUnit: z.literal('usd_per_normalized_base_quantity'),
    interpretation: z.literal('research_evidence_not_a_trade_recommendation'),
  }),
  segments: z.array(ShortStraddleEvaluationSegmentSchema),
});

export type ShortStraddleEvaluationResponse = z.infer<
  typeof ShortStraddleEvaluationResponseSchema
>;
