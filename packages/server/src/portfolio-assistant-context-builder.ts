import {
  buildPortfolioAssistantRiskFacts,
  findUncoveredShorts,
  type MarkContext,
  type PortfolioAssistantPositionFact,
  type PortfolioHorizonScenarios,
  type PortfolioMetricsComputation,
  type PortfolioRiskContributor,
  type PositionLeg,
  rankPortfolioRiskContributors,
  type UncoveredShort,
} from '@oggregator/core';
import type {
  ExchangePortfolioLedgerStore,
  ExchangePortfolioVenue,
  PersistedExchangeTrade,
} from '@oggregator/db';
import type {
  BreakEvenIvRow,
  ExpiryBucketRow,
  ExpiryRiskWindow,
  PortfolioAccounting,
  PortfolioPnlCurve,
  PortfolioPnlPoint,
  PortfolioSource,
  PortfolioTotals,
  ShockGridCell,
  ShockGridMeta,
  StrategyGroup,
  VegaByStrikeRow,
} from '@oggregator/protocol';
import type { CompactChain, CompactSurface } from './assistant-market/market-data-compaction.js';
import type { AssistantMarketDataReader } from './assistant-market/market-data-reader.js';
import { PortfolioRefStore } from './assistant-market/portfolio-ref.js';
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

export interface PortfolioAssistantTradeFact {
  tradedAt: string;
  instrument: string;
  side: 'buy' | 'sell';
  amount: number;
  priceUsd: number;
  premiumUsd: number;
  feeUsd: number | null;
  realizedPnlUsd: number | null;
  liquidityRole: 'maker' | 'taker' | null;
  orderId: string | null;
}

export interface PortfolioAssistantTradeHistoryFacts {
  venue: ExchangePortfolioVenue;
  underlying: string | null;
  trades: PortfolioAssistantTradeFact[];
  truncated: boolean;
}

export type PortfolioAssistantPayoffPoint = Omit<PortfolioPnlPoint, 'forwardPnlUsd'> & {
  forwardPnlUsd?: number | null;
};

export interface PortfolioAssistantPayoffFacts extends Omit<PortfolioPnlCurve, 'points'> {
  points: PortfolioAssistantPayoffPoint[];
}

export interface PortfolioAssistantUncoveredShort {
  legId: string;
  expiry: string;
  strike: number;
  right: 'call' | 'put';
  size: number;
}

export interface PortfolioAssistantRiskBudgetFacts {
  riskWindows: ExpiryRiskWindow[];
  /** Lowest entry-relative P&L across expiry windows; null when unbounded or unavailable (see note). */
  worstLossUsd: number | null;
  unboundedAfter: string | null;
  uncoveredShorts: PortfolioAssistantUncoveredShort[];
  note: string;
}

export interface PortfolioAssistantContext {
  headline: PortfolioAssistantHeadline;
  schemaVersion: 1;
  source: PortfolioSource;
  underlying: string | null;
  /** Opaque, 15-minute server-side handle to this book for the tools named in toolHints. */
  portfolioRef: string;
  toolHints: string[];
  riskBudgetFacts: PortfolioAssistantRiskBudgetFacts;
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
  payoffFacts: PortfolioAssistantPayoffFacts;
  horizonScenarios: PortfolioHorizonScenarios | null;
  marketFacts: PortfolioAssistantMarketFacts;
  shockFacts: { grid: ShockGridCell[][]; meta: ShockGridMeta } | null;
  accountingFacts: PortfolioAccounting | null;
  tradeHistoryFacts: PortfolioAssistantTradeHistoryFacts | null;
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
export const SCENARIO_HORIZONS_DAYS = [0, 1, 3, 5, 7, 10, 14, 21, 30];
export const SCENARIO_SPOT_MOVES_PCT = [-10, -5, -2, 0, 2, 5, 10];
const MARKET_UNDERLYING_LIMIT = 2;
const MARKET_EXPIRY_LIMIT = 4;
const CHAIN_STRIKE_BAND = 0.15;
const COMPACT_CHAIN_STRIKE_BAND = 0.07;
const TERM_STRUCTURE_EXPIRY_LIMIT = 12;
const TRADE_LOAD_LIMIT = 1_000;
export const TRADE_CONTEXT_LIMIT = 100;
const COMPACT_TRADE_CONTEXT_LIMIT = 30;
const PAYOFF_POINT_STRIDE = 3;
const SHOCK_TRIM_BUDGET_SHARE = 0.6;
const SHOCK_MAX_ATM_SHIFT_VOL_PTS = 10;
const SHOCK_MAX_SKEW_SHIFT_PER_LOG_K = 0.25;

export const CONTEXT_COMPACTED_LIMITATION =
  'Context was compacted deterministically to fit the model input limit.';

export const PORTFOLIO_ASSISTANT_TOOL_HINTS: readonly string[] = [
  'oggregator_evaluate_structure and oggregator_structure_search accept portfolioRef; no other tool does.',
  'oggregator_evaluate_structure with portfolioRef: price proposed legs together with this book (cost, fees, worst loss per expiry window, budget fit). Use it before quoting any combined max loss.',
  'oggregator_structure_search with portfolioRef: find trades for a view within a book-wide maxTotalRiskUsd; view hedge_held_shorts covers riskBudgetFacts.uncoveredShorts.',
];

function isLedgerVenue(source: PortfolioSource): source is ExchangePortfolioVenue {
  return source === 'thalex' || source === 'derive';
}

export function buildTradeHistoryFacts(
  venue: ExchangePortfolioVenue,
  trades: PersistedExchangeTrade[],
  underlying: string | null,
  limit: number,
): PortfolioAssistantTradeHistoryFacts {
  const matching = trades
    .filter((trade) => underlying == null || trade.underlying === underlying)
    .sort((a, b) => b.timestampMs - a.timestampMs);
  return {
    venue,
    underlying,
    trades: matching.slice(0, limit).map((trade) => ({
      tradedAt: new Date(trade.timestampMs).toISOString(),
      instrument: trade.instrumentName,
      side: trade.direction,
      amount: trade.amount,
      priceUsd: roundCents(trade.priceUsd),
      premiumUsd: roundCents(trade.priceUsd * trade.amount),
      feeUsd: trade.feeUsd == null ? null : roundCents(trade.feeUsd),
      realizedPnlUsd: trade.realizedPnlUsd == null ? null : roundCents(trade.realizedPnlUsd),
      liquidityRole: trade.liquidityRole,
      orderId: trade.orderId,
    })),
    truncated: matching.length > limit,
  };
}

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

function roundRiskWindow(window: ExpiryRiskWindow): ExpiryRiskWindow {
  return {
    ...window,
    lossAtZeroSpotUsd: roundCents(window.lossAtZeroSpotUsd),
    worstLossUsd: window.worstLossUsd == null ? null : roundCents(window.worstLossUsd),
  };
}

function extremumIndex(points: PortfolioPnlPoint[], pick: (a: number, b: number) => boolean): number {
  let found = 0;
  points.forEach((point, index) => {
    const current = points[found];
    if (current != null && pick(point.expiryPnlUsd, current.expiryPnlUsd)) found = index;
  });
  return found;
}

export function trimPayoffFacts(
  curve: PortfolioPnlCurve,
  forwardDays: number,
): PortfolioAssistantPayoffFacts {
  const { points } = curve;
  const keep = new Set<number>();
  for (let index = 0; index < points.length; index += PAYOFF_POINT_STRIDE) keep.add(index);
  if (points.length > 0) {
    keep.add(points.length - 1);
    keep.add(extremumIndex(points, (a, b) => a < b));
    keep.add(extremumIndex(points, (a, b) => a > b));
  }
  for (const breakEven of curve.breakEvenPricesUsd) {
    const above = points.findIndex((point) => point.underlyingPriceUsd >= breakEven);
    if (above === -1) continue;
    keep.add(above);
    if (above > 0) keep.add(above - 1);
  }
  return {
    ...curve,
    currentSpotUsd: curve.currentSpotUsd == null ? null : roundCents(curve.currentSpotUsd),
    breakEvenPricesUsd: curve.breakEvenPricesUsd.map(roundCents),
    maxProfitUsd: curve.maxProfitUsd == null ? null : roundCents(curve.maxProfitUsd),
    maxLossUsd: curve.maxLossUsd == null ? null : roundCents(curve.maxLossUsd),
    points: [...keep]
      .sort((a, b) => a - b)
      .flatMap((index) => points[index] ?? [])
      .map(({ forwardPnlUsd, ...point }) => {
        const rounded = {
          underlyingPriceUsd: roundCents(point.underlyingPriceUsd),
          nowPnlUsd: roundCents(point.nowPnlUsd),
          expiryPnlUsd: roundCents(point.expiryPnlUsd),
        };
        return forwardDays > 0
          ? { ...rounded, forwardPnlUsd: forwardPnlUsd == null ? null : roundCents(forwardPnlUsd) }
          : rounded;
      }),
    riskWindows: curve.riskWindows.map(roundRiskWindow),
  };
}

export function buildRiskBudgetFacts(
  payoff: Pick<PortfolioPnlCurve, 'status' | 'riskWindows'>,
  uncoveredShorts: UncoveredShort[] | null,
): PortfolioAssistantRiskBudgetFacts {
  const riskWindows = payoff.riskWindows.map(roundRiskWindow);
  const shorts = (uncoveredShorts ?? []).map((short) => ({
    legId: short.legId,
    expiry: short.expiry,
    strike: short.strike,
    right: short.optionRight,
    size: short.size,
  }));
  const facts = { riskWindows, uncoveredShorts: shorts };
  if (payoff.status !== 'ok' || riskWindows.length === 0) {
    return {
      ...facts,
      worstLossUsd: null,
      unboundedAfter: null,
      note: `Risk windows are unavailable (payoff status ${payoff.status}); worstLossUsd is unknown, not unbounded.`,
    };
  }
  const unbounded = riskWindows.find((window) => window.upsideUnbounded);
  if (unbounded != null) {
    return {
      ...facts,
      worstLossUsd: null,
      unboundedAfter: unbounded.from,
      note: `Loss is unbounded on a rally from ${unbounded.from} because live calls are net short; a total max-loss budget is only reachable after covering or closing uncoveredShorts.`,
    };
  }
  const worst = riskWindows.reduce((low, window) =>
    (window.worstLossUsd ?? 0) < (low.worstLossUsd ?? 0) ? window : low,
  );
  return {
    ...facts,
    worstLossUsd: worst.worstLossUsd,
    unboundedAfter: null,
    note: `worstLossUsd is the lowest entry-relative P&L across expiry windows (negative is a loss), at spot ${worst.worstLossSpotUsd ?? 'n/a'} by ${worst.until}. It is an expiry bound, not intraday margin.`,
  };
}

export function roundShockGrid(grid: ShockGridCell[][]): ShockGridCell[][] {
  return grid.map((row) => row.map((cell) => ({ ...cell, totalPnlUsd: roundCents(cell.totalPnlUsd) })));
}

export function trimShockGrid(grid: ShockGridCell[][]): ShockGridCell[][] {
  return grid
    .map((row) =>
      row.filter(
        (cell) =>
          Math.abs(cell.atmShiftVolPts) <= SHOCK_MAX_ATM_SHIFT_VOL_PTS &&
          Math.abs(cell.skewShiftPerLogK) <= SHOCK_MAX_SKEW_SHIFT_PER_LOG_K,
      ),
    )
    .filter((row) => row.length > 0);
}

export function compactPortfolioAssistantContext(
  context: PortfolioAssistantContext,
  heldPositions: Array<{ underlying: string; strike: number }>,
): PortfolioAssistantContext {
  return {
    ...context,
    positions: context.positions.slice(0, 50),
    strikeFacts: context.strikeFacts.slice(0, 60),
    breakEvenFacts: context.breakEvenFacts.slice(0, 50),
    strategyFacts: context.strategyFacts.slice(0, 25),
    tradeHistoryFacts:
      context.tradeHistoryFacts == null
        ? null
        : {
            ...context.tradeHistoryFacts,
            trades: context.tradeHistoryFacts.trades.slice(0, COMPACT_TRADE_CONTEXT_LIMIT),
            truncated:
              context.tradeHistoryFacts.truncated ||
              context.tradeHistoryFacts.trades.length > COMPACT_TRADE_CONTEXT_LIMIT,
          },
    marketFacts: {
      ...context.marketFacts,
      underlyings: context.marketFacts.underlyings.map((facts) => {
        const heldStrikes = new Set(
          heldPositions.filter((leg) => leg.underlying === facts.underlying).map((leg) => leg.strike),
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
            cells: context.horizonScenarios.cells.map((cell) => ({ ...cell, pnlByExpiryUsd: {} })),
          },
    limitations: [...context.limitations, CONTEXT_COMPACTED_LIMITATION],
  };
}

export interface AssemblePortfolioAssistantContextInput {
  source: PortfolioSource;
  underlying: string | null;
  forwardDays: number;
  nowMs: number;
  portfolioRef: string;
  computation: Pick<PortfolioMetricsComputation, 'positions' | 'metrics'>;
  legsWithMarks: Array<{ leg: PositionLeg; mark: MarkContext }> | null;
  horizonScenarios: PortfolioHorizonScenarios | null;
  marketFacts: PortfolioAssistantMarketFacts;
  tradeHistoryFacts: PortfolioAssistantTradeHistoryFacts | null;
  /** Limitations found while loading inputs, appended after the engine's own. */
  limitations: string[];
  maxContextCharacters: number;
}

export function assemblePortfolioAssistantContext(
  input: AssemblePortfolioAssistantContextInput,
): PortfolioAssistantContext {
  const { positions, metrics } = input.computation;
  const riskFacts = buildPortfolioAssistantRiskFacts(positions, metrics);
  const ageMs = Math.max(0, input.nowMs - metrics.generatedAt);
  const partial = riskFacts.limitations.length > 0;
  const limitations = [...riskFacts.limitations];
  if (riskFacts.mixedUnderlyings)
    limitations.push(
      'The portfolio contains mixed underlyings; one spot shock does not apply uniformly.',
    );
  if (positions.length > 100)
    limitations.push(
      `${positions.length - 100} position(s) were omitted after deterministic leg ID sorting.`,
    );
  if (metrics.byStrike.length > 120)
    limitations.push(
      `${metrics.byStrike.length - 120} strike row(s) were omitted after expiry/strike sorting.`,
    );
  if (metrics.byExpiry.length > 40)
    limitations.push(
      `${metrics.byExpiry.length - 40} expiry row(s) were omitted after expiry sorting.`,
    );
  const horizonScenarios = compactHorizonScenarios(input.horizonScenarios);
  if (horizonScenarios == null) {
    limitations.push('Multi-horizon scenarios could not be computed.');
  } else if (horizonScenarios.status !== 'ok') {
    limitations.push(`Multi-horizon scenario status is ${horizonScenarios.status}.`);
  }
  limitations.push(...input.limitations);

  const { totals, pnlCurve } = metrics;
  const expiries = [...new Set(positions.map((leg) => leg.expiry))].sort();
  const uncoveredShorts =
    input.legsWithMarks == null ? null : findUncoveredShorts(input.legsWithMarks, metrics.generatedAt);

  const context: PortfolioAssistantContext = {
    headline: {
      asOf: new Date(metrics.generatedAt).toISOString(),
      underlying: pnlCurve.underlying ?? input.underlying,
      spotUsd: pnlCurve.currentSpotUsd,
      unrealizedPnlUsd: riskFacts.missingMarkLegIds.length > 0 ? null : totals.unrealizedPnlUsd,
      netDeltaUsd: totals.netDeltaUsd,
      netThetaUsd: totals.netThetaUsd,
      netVegaUsd: totals.netVegaUsd,
      openLegCount: positions.length,
      nearestExpiry: expiries[0] ?? null,
    },
    schemaVersion: 1,
    source: input.source,
    underlying: input.underlying,
    portfolioRef: input.portfolioRef,
    toolHints: [...PORTFOLIO_ASSISTANT_TOOL_HINTS],
    riskBudgetFacts: buildRiskBudgetFacts(pnlCurve, uncoveredShorts),
    forwardDays: input.forwardDays,
    generatedAt: metrics.generatedAt,
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
    positions: [...riskFacts.positions].sort((a, b) => a.legId.localeCompare(b.legId)).slice(0, 100),
    totals,
    expiryFacts: metrics.byExpiry.slice(0, 40),
    strikeFacts: metrics.byStrike.slice(0, 120),
    strategyFacts: metrics.strategies.slice(0, 50),
    breakEvenFacts: metrics.breakEven.slice(0, 100),
    payoffFacts: trimPayoffFacts(pnlCurve, input.forwardDays),
    horizonScenarios,
    marketFacts: input.marketFacts,
    shockFacts:
      metrics.shockGrid.length > 0
        ? { grid: roundShockGrid(metrics.shockGrid), meta: metrics.shockGridMeta }
        : null,
    accountingFacts: metrics.accounting,
    tradeHistoryFacts: input.tradeHistoryFacts,
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

  let shaped = context;
  if (
    context.shockFacts != null &&
    JSON.stringify(context).length >= input.maxContextCharacters * SHOCK_TRIM_BUDGET_SHARE
  ) {
    shaped = {
      ...context,
      shockFacts: { ...context.shockFacts, grid: trimShockGrid(context.shockFacts.grid) },
      limitations: [
        ...context.limitations,
        `shockFacts.grid keeps ATM shifts within ±${SHOCK_MAX_ATM_SHIFT_VOL_PTS} vol points and skew tilts within ±${SHOCK_MAX_SKEW_SHIFT_PER_LOG_K} per log-strike to save context.`,
      ],
    };
  }
  return JSON.stringify(shaped).length > input.maxContextCharacters
    ? compactPortfolioAssistantContext(shaped, positions)
    : shaped;
}

export class PortfolioAssistantContextBuilder {
  constructor(
    private readonly configuration: PortfolioAssistantConfiguration,
    private readonly marketData: AssistantMarketDataReader | null = null,
    private readonly tradeLedger: ExchangePortfolioLedgerStore | null = null,
    private readonly now: () => number = Date.now,
    private readonly portfolioRefs: PortfolioRefStore = new PortfolioRefStore(),
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

  private async buildTradeHistory(
    input: BuildPortfolioAssistantContextInput,
    limitations: string[],
  ): Promise<PortfolioAssistantTradeHistoryFacts | null> {
    if (!isLedgerVenue(input.source)) return null;
    if (!this.tradeLedger?.enabled) {
      limitations.push('Venue trade history is unavailable because the trade ledger is not configured.');
      return null;
    }
    try {
      const trades = await this.tradeLedger.loadTrades(input.accountId, input.source, TRADE_LOAD_LIMIT);
      const facts = buildTradeHistoryFacts(input.source, trades, input.underlying, TRADE_CONTEXT_LIMIT);
      if (facts.truncated) {
        limitations.push(
          `tradeHistoryFacts lists the ${TRADE_CONTEXT_LIMIT} most recent trades; use accountingFacts for lifetime totals.`,
        );
      }
      return facts;
    } catch {
      limitations.push('Venue trade history could not be loaded.');
      return null;
    }
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
    const horizonScenarios = runtime.computeHorizonScenarios(
      [...SCENARIO_HORIZONS_DAYS, input.forwardDays],
      SCENARIO_SPOT_MOVES_PCT,
    );
    const marketFacts = await this.buildMarketFacts(
      snapshot.positions,
      input.underlying,
      snapshot.metrics.pnlCurve.currentSpotUsd,
    );
    const limitations: string[] = [];
    const tradeHistoryFacts = await this.buildTradeHistory(input, limitations);
    return assemblePortfolioAssistantContext({
      source: input.source,
      underlying: input.underlying,
      forwardDays: input.forwardDays,
      nowMs: this.now(),
      portfolioRef: this.portfolioRefs.mint({
        accountId: input.accountId,
        source: input.source,
        underlying: input.underlying,
        generatedAt: snapshot.metrics.generatedAt,
      }),
      computation: snapshot,
      legsWithMarks: runtime.legsWithMarks(),
      horizonScenarios,
      marketFacts,
      tradeHistoryFacts,
      limitations,
      maxContextCharacters: this.configuration.maxContextCharacters,
    });
  }
}
