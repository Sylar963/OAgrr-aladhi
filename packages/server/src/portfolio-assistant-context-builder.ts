import {
  buildPortfolioAssistantRiskFacts,
  type PortfolioAssistantPositionFact,
  type PortfolioHorizonScenarios,
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
import type { CompactChain, CompactSurface } from './assistant-market/market-data-compaction.js';
import type { AssistantMarketDataReader } from './assistant-market/market-data-reader.js';
import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';
import { bootstrapPortfolioForAccount, getOrCreatePortfolioRuntime } from './portfolio-services.js';

export interface PortfolioAssistantHeadline {
  asOf: string;
  underlying: string | null;
  spotUsd: number | null;
  unrealizedPnlUsd: number | null;
  netDeltaUsd: number | null;
  netThetaUsd: number | null;
  netVegaUsd: number | null;
  openLegCount: number;
  nearestExpiry: string | null;
}

export interface PortfolioAssistantUnderlyingMarketFacts {
  underlying: string;
  overview: Record<string, unknown> | null;
  termStructure: CompactSurface | null;
  heldExpiryChains: Array<CompactChain & { units: string }>;
}

export interface PortfolioAssistantMarketFacts {
  underlyings: PortfolioAssistantUnderlyingMarketFacts[];
  unavailable: string[];
}

export interface PortfolioAssistantContext {
  headline: PortfolioAssistantHeadline;
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
  horizonScenarios: PortfolioHorizonScenarios | null;
  marketFacts: PortfolioAssistantMarketFacts;
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
const SCENARIO_HORIZONS_DAYS = [0, 1, 3, 5, 7, 10, 14, 21, 30];
const SCENARIO_SPOT_MOVES_PCT = [-10, -5, -2, 0, 2, 5, 10];
const MARKET_UNDERLYING_LIMIT = 2;
const MARKET_EXPIRY_LIMIT = 4;
const CHAIN_STRIKE_BAND = 0.15;
const COMPACT_CHAIN_STRIKE_BAND = 0.07;
const TERM_STRUCTURE_EXPIRY_LIMIT = 12;

function narrowChain(
  chain: CompactChain & { units: string },
  band: number,
  heldStrikes: Set<number>,
): CompactChain & { units: string } {
  const reference = chain.stats.forwardPriceUsd ?? chain.stats.indexPriceUsd;
  if (reference == null) return chain;
  const rows = chain.rows.filter(
    (row) => heldStrikes.has(row.strike) || Math.abs(row.strike / reference - 1) <= band,
  );
  return {
    ...chain,
    strikeFilter: { minStrike: reference * (1 - band), maxStrike: reference * (1 + band) },
    strikesReturned: new Set(rows.map((row) => row.strike)).size,
    rows,
  };
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function compactHorizonScenarios(
  scenarios: PortfolioHorizonScenarios | null,
): PortfolioHorizonScenarios | null {
  if (scenarios == null) return null;
  return {
    ...scenarios,
    cells: scenarios.cells.map((cell) => ({
      ...cell,
      spotUsd: roundCents(cell.spotUsd),
      pnlUsd: roundCents(cell.pnlUsd),
      pnlByExpiryUsd: Object.fromEntries(
        Object.entries(cell.pnlByExpiryUsd).map(([expiry, pnl]) => [expiry, roundCents(pnl)]),
      ),
    })),
  };
}

export class PortfolioAssistantContextBuilder {
  constructor(
    private readonly configuration: PortfolioAssistantConfiguration,
    private readonly marketData: AssistantMarketDataReader | null = null,
    private readonly now: () => number = Date.now,
  ) {}

  private async buildMarketFacts(
    positions: Array<{ underlying: string; expiry: string; strike: number }>,
    fallbackUnderlying: string | null,
    spotUsd: number | null,
  ): Promise<PortfolioAssistantMarketFacts> {
    const reader = this.marketData;
    if (!reader) return { underlyings: [], unavailable: ['Market data reader is not configured.'] };
    const underlyings = [...new Set(positions.map((leg) => leg.underlying))];
    if (underlyings.length === 0 && fallbackUnderlying) underlyings.push(fallbackUnderlying);
    const unavailable: string[] = [];
    if (underlyings.length > MARKET_UNDERLYING_LIMIT) {
      unavailable.push(
        `Market facts cover ${MARKET_UNDERLYING_LIMIT} of ${underlyings.length} underlyings; use tools for the rest.`,
      );
    }
    const facts = await Promise.all(
      underlyings.slice(0, MARKET_UNDERLYING_LIMIT).map(async (underlying) => {
        const legs = positions.filter((leg) => leg.underlying === underlying);
        const expiries = [...new Set(legs.map((leg) => leg.expiry))].sort();
        if (expiries.length > MARKET_EXPIRY_LIMIT) {
          unavailable.push(
            `${underlying}: chains included for the ${MARKET_EXPIRY_LIMIT} nearest of ${expiries.length} held expiries.`,
          );
        }
        const reference = underlyings.length === 1 ? spotUsd : null;
        const [overview, surface, ...chains] = await Promise.all([
          reader.marketOverview(underlying),
          reader.volSurface(underlying, {
            includeVenueAtm: false,
            maxExpiries: TERM_STRUCTURE_EXPIRY_LIMIT,
          }),
          ...expiries.slice(0, MARKET_EXPIRY_LIMIT).map((expiry) =>
            reader.optionChain(underlying, expiry, {
              minStrike: reference == null ? undefined : reference * (1 - CHAIN_STRIKE_BAND),
              maxStrike: reference == null ? undefined : reference * (1 + CHAIN_STRIKE_BAND),
              includeStrikes: legs.filter((leg) => leg.expiry === expiry).map((leg) => leg.strike),
            }),
          ),
        ]);
        if (!overview.ok) unavailable.push(`${underlying} overview: ${overview.error}`);
        if (!surface.ok) unavailable.push(`${underlying} term structure: ${surface.error}`);
        const heldStrikes = new Set(legs.map((leg) => leg.strike));
        const heldExpiryChains: Array<CompactChain & { units: string }> = [];
        chains.forEach((chain, index) => {
          if (chain.ok) {
            heldExpiryChains.push(
              reference == null ? narrowChain(chain.data, CHAIN_STRIKE_BAND, heldStrikes) : chain.data,
            );
          } else {
            unavailable.push(`${underlying} ${expiries[index]} chain: ${chain.error}`);
          }
        });
        return {
          underlying,
          overview: overview.ok ? overview.data : null,
          termStructure: surface.ok ? surface.data : null,
          heldExpiryChains,
        };
      }),
    );
    return { underlyings: facts, unavailable };
  }

  async buildPortfolioAssistantContext(
    input: BuildPortfolioAssistantContextInput,
  ): Promise<PortfolioAssistantContext> {
    const underlying = input.underlying ?? undefined;
    await bootstrapPortfolioForAccount(input.accountId, input.source, underlying);
    const runtime = getOrCreatePortfolioRuntime(input.accountId, input.source, underlying);
    const snapshot = runtime.computeMetricsAt(input.forwardDays);
    if (snapshot.error != null) {
      throw new PortfolioAssistantServiceError(
        'portfolio_unavailable',
        'Portfolio analytics are not available right now.',
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

    const horizonScenarios = compactHorizonScenarios(
      runtime.computeHorizonScenarios(
        [...SCENARIO_HORIZONS_DAYS, input.forwardDays],
        SCENARIO_SPOT_MOVES_PCT,
      ),
    );
    if (horizonScenarios == null) {
      limitations.push('Multi-horizon scenarios could not be computed.');
    } else if (horizonScenarios.status !== 'ok') {
      limitations.push(`Multi-horizon scenario status is ${horizonScenarios.status}.`);
    }
    const { totals, pnlCurve } = snapshot.metrics;
    const marketFacts = await this.buildMarketFacts(
      snapshot.positions,
      input.underlying,
      pnlCurve.currentSpotUsd,
    );
    const expiries = [...new Set(snapshot.positions.map((leg) => leg.expiry))].sort();

    const context: PortfolioAssistantContext = {
      headline: {
        asOf: new Date(snapshot.metrics.generatedAt).toISOString(),
        underlying: pnlCurve.underlying ?? input.underlying,
        spotUsd: pnlCurve.currentSpotUsd,
        unrealizedPnlUsd: riskFacts.missingMarkLegIds.length > 0 ? null : totals.unrealizedPnlUsd,
        netDeltaUsd: totals.netDeltaUsd,
        netThetaUsd: totals.netThetaUsd,
        netVegaUsd: totals.netVegaUsd,
        openLegCount: snapshot.positions.length,
        nearestExpiry: expiries[0] ?? null,
      },
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
      horizonScenarios,
      marketFacts,
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
        marketFacts: {
          ...context.marketFacts,
          underlyings: context.marketFacts.underlyings.map((facts) => {
            const heldStrikes = new Set(
              snapshot.positions
                .filter((leg) => leg.underlying === facts.underlying)
                .map((leg) => leg.strike),
            );
            return {
              ...facts,
              heldExpiryChains: facts.heldExpiryChains.map((chain) =>
                narrowChain(chain, COMPACT_CHAIN_STRIKE_BAND, heldStrikes),
              ),
            };
          }),
        },
        horizonScenarios:
          context.horizonScenarios == null
            ? null
            : {
                ...context.horizonScenarios,
                cells: context.horizonScenarios.cells.map((cell) => ({
                  ...cell,
                  pnlByExpiryUsd: {},
                })),
              },
        limitations: [
          ...context.limitations,
          'Context was compacted deterministically to fit the model input limit.',
        ],
      };
    }
    return context;
  }
}
