import {
  BreakEvenIvRowSchema,
  ExchangePortfolioVenueSchema,
  ExpiryBucketRowSchema,
  PortfolioAccountingSchema,
  PortfolioAssistantMessageSchema,
  PortfolioPnlCurveSchema,
  PortfolioPnlCurveStatusSchema,
  PortfolioSourceSchema,
  PortfolioTotalsSchema,
  ShockGridCellSchema,
  ShockGridMetaSchema,
  StrategyGroupSchema,
  VegaByStrikeRowSchema,
} from '@oggregator/protocol';
import { z } from 'zod';

import type { PortfolioAssistantContext } from '../portfolio-assistant-context-builder.js';

interface ForeignSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

// @oggregator/protocol is built on Zod 3, whose schemas cannot be nested in Zod 4 objects.
function protocol<T>(schema: ForeignSchema<T>) {
  return z.unknown().transform((value, context): T => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    context.addIssue({ code: 'custom', message: parsed.error.message });
    return z.NEVER;
  });
}

const nullableNumber = z.number().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionRight = z.enum(['call', 'put']);

const CompactChainRowSchema = z.object({
  strike: z.number(),
  side: optionRight,
  bestBidUsd: nullableNumber,
  bestBidVenue: z.string().nullable(),
  bestBidSize: nullableNumber,
  bestAskUsd: nullableNumber,
  bestAskVenue: z.string().nullable(),
  bestAskSize: nullableNumber,
  medianMidUsd: nullableNumber,
  medianMarkIv: nullableNumber,
  delta: nullableNumber,
  gamma: nullableNumber,
  thetaUsdPerDay: nullableNumber,
  vegaUsd: nullableNumber,
  openInterestContracts: nullableNumber,
  volume24hContracts: nullableNumber,
  quotingVenues: z.number().int().nonnegative(),
});

const CompactChainSchema = z.object({
  underlying: z.string(),
  expiry: isoDate,
  expiryIso: z.string().nullable(),
  daysToExpiry: z.number(),
  stats: z.object({
    forwardPriceUsd: nullableNumber,
    indexPriceUsd: nullableNumber,
    atmStrike: nullableNumber,
    atmIv: nullableNumber,
    skew25d: nullableNumber,
    bfly25d: nullableNumber,
    putCallOiRatio: nullableNumber,
    totalOiUsd: nullableNumber,
  }),
  strikeFilter: z.object({ minStrike: nullableNumber, maxStrike: nullableNumber }),
  strikesAvailable: z.number().int().nonnegative(),
  strikesReturned: z.number().int().nonnegative(),
  rows: z.array(CompactChainRowSchema),
  units: z.string(),
});

const CompactSurfaceSchema = z.object({
  underlying: z.string(),
  termStructure: z.string().nullable(),
  rows: z.array(
    z.object({
      expiry: isoDate,
      daysToExpiry: z.number(),
      iv10dPut: nullableNumber,
      iv25dPut: nullableNumber,
      ivAtm: nullableNumber,
      iv25dCall: nullableNumber,
      iv10dCall: nullableNumber,
      riskReversal25d: nullableNumber,
      butterfly25d: nullableNumber,
      venueAtmIv: z.record(z.string(), z.number()).exactOptional(),
    }),
  ),
});

const RiskContributorSchema = z.object({
  key: z.string(),
  dimension: z.enum(['strike', 'expiry']),
  expiry: isoDate,
  strike: nullableNumber,
  optionRight: optionRight.nullable(),
  metric: z.enum(['delta', 'gamma', 'vega', 'theta', 'vanna', 'volga']),
  value: z.number(),
});

const PortfolioAssistantContextSchema = z.object({
  headline: z.object({
    asOf: z.string(),
    underlying: z.string().nullable(),
    spotUsd: nullableNumber,
    unrealizedPnlUsd: nullableNumber,
    netDeltaUsd: nullableNumber,
    netThetaUsd: nullableNumber,
    netVegaUsd: nullableNumber,
    openLegCount: z.number().int().nonnegative(),
    nearestExpiry: isoDate.nullable(),
  }),
  schemaVersion: z.literal(1),
  source: protocol(PortfolioSourceSchema),
  underlying: z.string().nullable(),
  forwardDays: z.number().int().nonnegative(),
  generatedAt: z.number().int().nonnegative(),
  dataFreshness: z.object({
    state: z.enum(['fresh', 'stale', 'partial']),
    staleAfterMs: z.number().int().positive(),
    explanation: z.string().nullable(),
  }),
  positions: z.array(
    z.object({
      legId: z.string(),
      underlying: z.string(),
      expiry: isoDate,
      strike: z.number(),
      optionRight,
      size: z.number(),
      entryPriceUsd: z.number(),
      entryIv: nullableNumber,
      currentMarkUsd: nullableNumber,
      currentIv: nullableNumber,
      currentIvIsModel: z.boolean(),
    }),
  ),
  totals: protocol(PortfolioTotalsSchema).nullable(),
  expiryFacts: z.array(protocol(ExpiryBucketRowSchema)),
  strikeFacts: z.array(protocol(VegaByStrikeRowSchema)),
  strategyFacts: z.array(protocol(StrategyGroupSchema)),
  breakEvenFacts: z.array(protocol(BreakEvenIvRowSchema)),
  payoffFacts: protocol(PortfolioPnlCurveSchema),
  horizonScenarios: z
    .object({
      status: protocol(PortfolioPnlCurveStatusSchema),
      underlying: z.string().nullable(),
      currentSpotUsd: nullableNumber,
      ivAssumption: z.literal('current_iv_held_constant'),
      horizonsDays: z.array(z.number()),
      spotMovesPct: z.array(z.number()),
      cells: z.array(
        z.object({
          horizonDays: z.number(),
          spotMovePct: z.number(),
          spotUsd: z.number(),
          pnlUsd: z.number(),
          pnlByExpiryUsd: z.record(z.string(), z.number()),
        }),
      ),
    })
    .nullable(),
  marketFacts: z.object({
    underlyings: z.array(
      z.object({
        underlying: z.string(),
        overview: z.record(z.string(), z.unknown()).nullable(),
        termStructure: CompactSurfaceSchema.nullable(),
        heldExpiryChains: z.array(CompactChainSchema),
      }),
    ),
    unavailable: z.array(z.string()),
  }),
  shockFacts: z
    .object({ grid: z.array(z.array(protocol(ShockGridCellSchema))), meta: protocol(ShockGridMetaSchema) })
    .nullable(),
  accountingFacts: protocol(PortfolioAccountingSchema).nullable(),
  tradeHistoryFacts: z
    .object({
      venue: protocol(ExchangePortfolioVenueSchema),
      underlying: z.string().nullable(),
      trades: z.array(
        z.object({
          tradedAt: z.string(),
          instrument: z.string(),
          side: z.enum(['buy', 'sell']),
          amount: z.number(),
          priceUsd: z.number(),
          premiumUsd: z.number(),
          feeUsd: nullableNumber,
          realizedPnlUsd: nullableNumber,
          liquidityRole: z.enum(['maker', 'taker']).nullable(),
          orderId: z.string().nullable(),
        }),
      ),
      truncated: z.boolean(),
    })
    .nullable(),
  topContributors: z.object({
    delta: z.array(RiskContributorSchema),
    gamma: z.array(RiskContributorSchema),
    vega: z.array(RiskContributorSchema),
    theta: z.array(RiskContributorSchema),
    vanna: z.array(RiskContributorSchema),
    volga: z.array(RiskContributorSchema),
  }),
  limitations: z.array(z.string()),
});

export const AssistantEvalExpectedNumberSchema = z.object({
  label: z.string().min(1),
  value: z.number(),
  tolerance: z.number().nonnegative(),
  source: z.string().min(1),
});
export type AssistantEvalExpectedNumber = z.infer<typeof AssistantEvalExpectedNumberSchema>;

export const AssistantEvalRequiredMentionSchema = z.object({
  label: z.string().min(1),
  anyOf: z.array(z.string().min(1)).min(1),
});
export type AssistantEvalRequiredMention = z.infer<typeof AssistantEvalRequiredMentionSchema>;

export const AssistantEvalExpectSchema = z.object({
  numbers: z.array(AssistantEvalExpectedNumberSchema),
  requiredMentions: z.array(AssistantEvalRequiredMentionSchema),
  requiredTools: z.array(z.string().min(1)),
  mustProposeStructure: z.boolean(),
  bannedPhrases: z.array(z.string().min(1)),
  maxChars: z.number().int().positive(),
});
export type AssistantEvalExpect = z.infer<typeof AssistantEvalExpectSchema>;

export const AssistantEvalScenarioSchema = z.enum([
  'reference_diagonal',
  'budget_trade',
  'horizon_lookup',
  'trade_history',
  'market_tools',
  'stale_history',
  'infeasible_budget',
]);

export const AssistantEvalFixtureSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().min(1),
  scenario: AssistantEvalScenarioSchema,
  question: z.string().trim().min(1).max(4_000),
  history: z.array(protocol(PortfolioAssistantMessageSchema)),
  context: PortfolioAssistantContextSchema,
  expect: AssistantEvalExpectSchema,
  provenance: z.object({
    generator: z.string().min(1),
    nowIso: z.string(),
    notes: z.array(z.string()),
  }),
});
export type AssistantEvalFixture = z.infer<typeof AssistantEvalFixtureSchema>;

export function fixtureContext(fixture: AssistantEvalFixture): PortfolioAssistantContext {
  return fixture.context;
}
