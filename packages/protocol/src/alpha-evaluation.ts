import { z } from 'zod';

const finite = z.number().finite();
const positive = finite.positive().max(1e12);
const nonnegative = finite.nonnegative().max(1e12);
const timestamp = finite.int().positive();
const nullable = finite.nullable();

export const AlphaEvaluationStrategySchema = z.enum([
  'call-credit',
  'put-credit',
  'call-debit',
  'put-debit',
  'long-call',
  'long-put',
  'protective-put',
]);

export const AlphaEvaluationLegSchema = z
  .object({
    venue: z.string().trim().min(1).max(40),
    instrument: z.string().trim().min(1).max(160),
    right: z.enum(['call', 'put']),
    side: z.enum(['buy', 'sell']),
    strike: positive,
    quantity: positive,
    price: positive,
    fee: nonnegative.nullable(),
    availableQuantity: nonnegative.nullable(),
    minQuantity: positive.nullable(),
    quantityStep: positive.nullable(),
    quotedAt: timestamp.nullable(),
    quoteMode: z.enum(['live', 'delayed', 'unknown']),
    markIv: finite.positive().max(10).nullable(),
    inverse: z.boolean(),
    settlement: z.string().min(1).max(20),
  })
  .strict();

export const AlphaEvaluationCandidateSchema = z
  .object({
    strategy: AlphaEvaluationStrategySchema,
    underlying: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .transform((v) => v.toUpperCase()),
    expiryTs: timestamp,
    spot: positive,
    atmIv: finite.positive().max(10).nullable(),
    legs: z.array(AlphaEvaluationLegSchema).min(1).max(2),
    holdingQuantity: nonnegative,
    entryFee: nonnegative.nullable(),
    costReserve: nonnegative.nullable(),
    lossBudget: positive.nullable(),
  })
  .strict()
  .superRefine((candidate, ctx) => {
    const { strategy, legs, holdingQuantity } = candidate;
    const right = strategy.startsWith('call') || strategy === 'long-call' ? 'call' : 'put';
    const single = strategy.startsWith('long-') || strategy === 'protective-put';
    const buy = legs.find((leg) => leg.side === 'buy');
    const sell = legs.find((leg) => leg.side === 'sell');
    let valid = legs.every((leg) => leg.right === right);
    if (single) valid &&= legs.length === 1 && buy != null;
    else {
      valid &&= legs.length === 2 && buy != null && sell != null;
      if (buy && sell) {
        const debit = strategy.endsWith('debit');
        valid &&= buy.quantity === sell.quantity;
        valid &&=
          right === 'call'
            ? debit
              ? buy.strike < sell.strike
              : buy.strike > sell.strike
            : debit
              ? buy.strike > sell.strike
              : buy.strike < sell.strike;
      }
    }
    valid &&= strategy === 'protective-put' ? holdingQuantity > 0 : holdingQuantity === 0;
    const cash = legs.reduce(
      (sum, leg) => sum + (leg.side === 'sell' ? 1 : -1) * leg.quantity * leg.price,
      0,
    );
    valid &&= strategy.endsWith('credit') ? cash > 0 : cash < 0;
    if (!valid)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Legs and holding do not match the strategy',
        path: ['legs'],
      });
  });

export const AlphaEvaluationScenarioSchema = z
  .object({
    meanReturnPct: finite.min(-99.99).max(1_000),
    annualVol: finite.min(0).max(5),
    meanUncertaintyPct: finite.min(0).max(100),
  })
  .strict()
  .refine((s) => s.meanReturnPct - s.meanUncertaintyPct > -100, {
    message: 'The lower mean-return scenario must stay above −100%',
    path: ['meanUncertaintyPct'],
  });

export const AlphaEvaluationRequestSchema = z
  .object({
    candidate: AlphaEvaluationCandidateSchema,
    scenario: AlphaEvaluationScenarioSchema.nullable(),
    thesis: z.string().trim().max(1_000),
    invalidation: z.string().trim().max(1_000),
  })
  .strict();

export const AlphaExecutionIssueSchema = z.enum([
  'expired',
  'future-quote',
  'missing-quote-time',
  'stale-quote',
  'unsynchronized-legs',
  'missing-size',
  'insufficient-size',
  'missing-fees',
  'missing-cost-reserve',
  'inverse-settlement',
  'cross-venue',
  'mixed-settlement',
  'missing-budget',
  'over-budget',
  'missing-quantity-rules',
  'invalid-quantity',
  'delayed-feed',
  'unknown-feed',
]);

const ScenarioResultSchema = z.object({
  expectedPnl: finite,
  probabilityOfProfit: finite.min(0).max(1),
  pnl05: finite,
  expectedShortfall95: finite,
  meanSpot: positive,
});

export const AlphaEvaluationResponseSchema = z.object({
  id: z.string().uuid(),
  version: z.literal('alpha-evaluation-v1'),
  evaluatedAt: timestamp,
  request: AlphaEvaluationRequestSchema,
  direction: z.enum(['bullish', 'bearish', 'insurance']),
  alignment: z.enum(['aligned', 'conflicts', 'flat-thesis', 'not-specified', 'insurance']),
  pricing: z.object({
    horizonDays: finite,
    forecastVol: nullable,
    forecastMethod: z.literal('mean-reverting-realized-v1'),
    forecastSupported: z.boolean(),
    atmIv: nullable,
    ivMinusForecast: nullable,
    usualPremium: nullable,
    excessPremium: nullable,
    baselineTenorDays: z.union([z.literal(7), z.literal(30)]).nullable(),
    baselineSource: z.enum(['venue', 'blended']).nullable(),
    baselineIndependentSamples: finite.nonnegative(),
    historyThrough: timestamp.nullable(),
  }),
  stress: z.object({
    rv7d: nullable,
    rv30d: nullable,
    accelerationRatio: nullable,
    return1dPct: nullable,
    return7dPct: nullable,
    return30dPct: nullable,
    termSlope: nullable,
    skew25d: nullable,
    regime: z
      .object({
        volatility: z.enum(['low-vol', 'mid-vol', 'high-vol']).nullable(),
        skewSentiment: z.enum(['risk-on', 'neutral', 'risk-off']).nullable(),
        clusterConfidence: nullable,
        observedAt: timestamp.nullable(),
      })
      .nullable(),
  }),
  execution: z.object({
    status: z.enum(['checks-pass', 'incomplete', 'blocked']),
    issues: z.array(AlphaExecutionIssueSchema),
    quoteSource: z.literal('client-snapshot'),
  }),
  payoff: z.object({
    grossEntryCash: finite,
    netEntryCash: nullable,
    maxExpiryLoss: nullable,
    budgetUsePct: nullable,
    stressPoints: z.array(z.object({ movePct: finite, spot: nonnegative, pnl: finite })),
    protection: z
      .object({
        coveredQuantity: positive,
        coverageRatio: positive,
        premiumCost: nullable,
        unhedgedLossAtZero: finite,
        hedgedLossAtZero: nullable,
      })
      .nullable(),
  }),
  scenario: ScenarioResultSchema.extend({
    lowerMeanExpectedPnl: finite,
    upperMeanExpectedPnl: finite,
  }).nullable(),
  evidence: z.literal('unvalidated'),
});

export const AlphaEvaluationOutcomeSchema = z
  .object({
    evaluationId: z.string().uuid(),
    recordedAt: timestamp,
    closedAt: timestamp,
    kind: z.enum(['expiry', 'early-exit', 'not-traded']),
    netPnl: finite.nullable(),
    settlementPrice: positive.nullable(),
    note: z.string().trim().max(1_000),
  })
  .strict()
  .superRefine((outcome, ctx) => {
    if (
      outcome.closedAt > outcome.recordedAt ||
      (outcome.kind === 'not-traded') !== (outcome.netPnl == null) ||
      (outcome.kind !== 'expiry' && outcome.settlementPrice != null)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Outcome time or net P&L is invalid' });
    }
  });

export const AlphaEvaluationJournalRecordSchema = AlphaEvaluationResponseSchema.extend({
  savedAt: timestamp,
});

export type AlphaEvaluationCandidate = z.infer<typeof AlphaEvaluationCandidateSchema>;
export type AlphaEvaluationLeg = z.infer<typeof AlphaEvaluationLegSchema>;
export type AlphaEvaluationRequest = z.infer<typeof AlphaEvaluationRequestSchema>;
export type AlphaEvaluationResponse = z.infer<typeof AlphaEvaluationResponseSchema>;
export type AlphaEvaluationScenario = z.infer<typeof AlphaEvaluationScenarioSchema>;
export type AlphaExecutionIssue = z.infer<typeof AlphaExecutionIssueSchema>;
export type AlphaEvaluationOutcome = z.infer<typeof AlphaEvaluationOutcomeSchema>;
export type AlphaEvaluationJournalRecord = z.infer<typeof AlphaEvaluationJournalRecordSchema>;
