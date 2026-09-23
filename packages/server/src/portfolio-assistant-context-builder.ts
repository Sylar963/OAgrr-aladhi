import {
  buildPortfolioAssistantRiskFacts,
  type PortfolioAssistantPositionFact,
  type PortfolioRiskContributor,
  rankPortfolioRiskContributors,
} from '@oggregator/core';
import type {
  BreakEvenIvRow,
  ExpiryBucketRow,
  PortfolioAccounting,
  PortfolioPnlCurve,
  PortfolioSource,
  PortfolioTotals,
  ShockGridCell,
  ShockGridMeta,
  StrategyGroup,
  VegaByStrikeRow,
} from '@oggregator/protocol';
import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';
import { bootstrapPortfolioForAccount, getOrCreatePortfolioRuntime } from './portfolio-services.js';

export interface PortfolioAssistantContext {
  schemaVersion: 1;
  source: PortfolioSource;
  underlying: string | null;
  forwardDays: number;
  generatedAt: number;
  dataFreshness: {
    state: 'fresh' | 'stale' | 'partial';
    staleAfterMs: number;
    explanation: string | null;
  };
  positions: PortfolioAssistantPositionFact[];
  totals: PortfolioTotals | null;
  expiryFacts: ExpiryBucketRow[];
  strikeFacts: VegaByStrikeRow[];
  strategyFacts: StrategyGroup[];
  breakEvenFacts: BreakEvenIvRow[];
  payoffFacts: PortfolioPnlCurve;
  shockFacts: { grid: ShockGridCell[][]; meta: ShockGridMeta } | null;
  accountingFacts: PortfolioAccounting | null;
  topContributors: Record<
    'delta' | 'gamma' | 'vega' | 'theta' | 'vanna' | 'volga',
    PortfolioRiskContributor[]
  >;
  limitations: string[];
}

export interface BuildPortfolioAssistantContextInput {
  accountId: string;
  source: PortfolioSource;
  underlying: string | null;
  forwardDays: number;
}

const STALE_AFTER_MS = 30_000;

export class PortfolioAssistantContextBuilder {
  constructor(
    private readonly configuration: PortfolioAssistantConfiguration,
    private readonly now: () => number = Date.now,
  ) {}

  async buildPortfolioAssistantContext(
    input: BuildPortfolioAssistantContextInput,
  ): Promise<PortfolioAssistantContext> {
    const underlying = input.underlying ?? undefined;
    await bootstrapPortfolioForAccount(input.accountId, input.source, underlying);
    const runtime = getOrCreatePortfolioRuntime(input.accountId, input.source, underlying);
    runtime.setForwardDays(input.forwardDays);
    const snapshot = runtime.getSnapshot();
    if (!snapshot) {
      throw new PortfolioAssistantServiceError(
        'portfolio_unavailable',
        'Portfolio analytics are not available yet.',
        503,
        true,
      );
    }
    const riskFacts = buildPortfolioAssistantRiskFacts(snapshot.positions, snapshot.metrics);
    const ageMs = Math.max(0, this.now() - snapshot.metrics.generatedAt);
    const partial = riskFacts.limitations.length > 0;
    const limitations = [...riskFacts.limitations];
    if (riskFacts.mixedUnderlyings)
      limitations.push(
        'The portfolio contains mixed underlyings; one spot shock does not apply uniformly.',
      );
    if (snapshot.positions.length > 100)
      limitations.push(
        `${snapshot.positions.length - 100} position(s) were omitted after deterministic leg ID sorting.`,
      );
    if (snapshot.metrics.byStrike.length > 120)
      limitations.push(
        `${snapshot.metrics.byStrike.length - 120} strike row(s) were omitted after expiry/strike sorting.`,
      );
    if (snapshot.metrics.byExpiry.length > 40)
      limitations.push(
        `${snapshot.metrics.byExpiry.length - 40} expiry row(s) were omitted after expiry sorting.`,
      );

    const context: PortfolioAssistantContext = {
      schemaVersion: 1,
      source: input.source,
      underlying: input.underlying,
      forwardDays: input.forwardDays,
      generatedAt: snapshot.metrics.generatedAt,
      dataFreshness: {
        state: ageMs > STALE_AFTER_MS ? 'stale' : partial ? 'partial' : 'fresh',
        staleAfterMs: STALE_AFTER_MS,
        explanation:
          ageMs > STALE_AFTER_MS
            ? `Snapshot is ${ageMs} ms old.`
            : partial
              ? 'Some calculations have explicit exclusions or unavailable inputs.'
              : null,
      },
      positions: [...riskFacts.positions]
        .sort((a, b) => a.legId.localeCompare(b.legId))
        .slice(0, 100),
      totals: snapshot.metrics.totals,
      expiryFacts: snapshot.metrics.byExpiry.slice(0, 40),
      strikeFacts: snapshot.metrics.byStrike.slice(0, 120),
      strategyFacts: snapshot.metrics.strategies.slice(0, 50),
      breakEvenFacts: snapshot.metrics.breakEven.slice(0, 100),
      payoffFacts: snapshot.metrics.pnlCurve,
      shockFacts:
        snapshot.metrics.shockGrid.length > 0
          ? { grid: snapshot.metrics.shockGrid, meta: snapshot.metrics.shockGridMeta }
          : null,
      accountingFacts: snapshot.metrics.accounting,
      topContributors: {
        delta: rankPortfolioRiskContributors(riskFacts, 'delta').slice(0, 10),
        gamma: rankPortfolioRiskContributors(riskFacts, 'gamma').slice(0, 10),
        vega: rankPortfolioRiskContributors(riskFacts, 'vega').slice(0, 10),
        theta: rankPortfolioRiskContributors(riskFacts, 'theta').slice(0, 10),
        vanna: rankPortfolioRiskContributors(riskFacts, 'vanna').slice(0, 10),
        volga: rankPortfolioRiskContributors(riskFacts, 'volga').slice(0, 10),
      },
      limitations,
    };
    if (JSON.stringify(context).length > this.configuration.maxContextCharacters) {
      return {
        ...context,
        positions: context.positions.slice(0, 50),
        strikeFacts: context.strikeFacts.slice(0, 60),
        breakEvenFacts: context.breakEvenFacts.slice(0, 50),
        strategyFacts: context.strategyFacts.slice(0, 25),
        limitations: [
          ...context.limitations,
          'Context was compacted deterministically to fit the model input limit.',
        ],
      };
    }
    return context;
  }
}
