import type {
  BreakEvenIvRow,
  ExpiryBucketRow,
  PortfolioAccounting,
  PortfolioMetrics,
  PortfolioPnlCurve,
  PortfolioTotals,
  PositionLeg,
  ShockGridCell,
  ShockGridMeta,
  StrategyGroup,
  VegaByStrikeRow,
} from '@oggregator/protocol';

import { logger } from '../../utils/logger.js';

import {
  aggregateGreeksByExpiry,
  aggregateGreeksByStrike,
  breakEvenIvCurve,
  computeTotals,
} from '../../portfolio/aggregator.js';
import { buildPortfolioPnlCurve } from '../../portfolio/pnl-curve.js';
import { computeShockGrid, getShockGridMeta } from '../../portfolio/scenarios.js';
import { detectStrategyGroups } from '../../portfolio/strategy-groups.js';
import type {
  MarkProvider,
  PositionStore,
} from '../../portfolio/types.js';

const PUSH_INTERVAL_MS = 200;

export interface PortfolioSnapshotEvent {
  type: 'snapshot';
  seq: number;
  positions: PositionLeg[];
  metrics: PortfolioMetrics;
}

export interface PortfolioDeltaEvent {
  type: 'delta';
  seq: number;
  metrics: PortfolioMetrics;
  changedLegIds: string[];
}

export interface PortfolioErrorEvent {
  type: 'error';
  code: string;
  message: string;
}

export type PortfolioRuntimeEvent =
  | PortfolioSnapshotEvent
  | PortfolioDeltaEvent
  | PortfolioErrorEvent;

export interface PortfolioRuntimeListener {
  onEvent(event: PortfolioRuntimeEvent): void;
}

export interface ChainSurfaceProvider {
  getAtmStrike(underlying: string, expiry: string): number | null;
  subscribeChainTicks(listener: () => void): () => void;
}

export interface PortfolioRuntimeOptions {
  accountId: string;
  forwardDays?: number;
  store: PositionStore;
  markProvider: MarkProvider;
  chainSurface?: ChainSurfaceProvider;
  now?: () => number;
  // When set, the runtime emits metrics only for legs whose `underlying`
  // matches. Used by the UI's per-asset view. Omit to include every leg.
  underlyingFilter?: string;
}

function emptyTotals(): PortfolioTotals {
  return {
    netDeltaUsd: 0,
    netGammaUsd: 0,
    netVegaUsd: 0,
    netThetaUsd: 0,
    netVannaUsd: 0,
    netVolgaUsd: 0,
    unrealizedPnlUsd: 0,
  };
}

function positionAccounting(positions: PositionLeg[]): PortfolioAccounting {
  let openGrossDebitUsd = 0;
  let openGrossCreditUsd = 0;
  let realizedPnlUsd = 0;
  for (const leg of positions) {
    const premium = leg.entryPriceUsd * Math.abs(leg.size);
    if (leg.size > 0) openGrossDebitUsd += premium;
    else openGrossCreditUsd += premium;
    realizedPnlUsd += leg.realizedPnlUsd;
  }
  return {
    openGrossDebitUsd,
    openGrossCreditUsd,
    openNetPremiumUsd: openGrossDebitUsd - openGrossCreditUsd,
    lifetimeGrossDebitUsd: null,
    lifetimeGrossCreditUsd: null,
    knownFeesUsd: null,
    realizedPnlUsd,
    persistedTradeCount: null,
    historyFromMs: null,
    lastSyncedAtMs: null,
    persistence: 'unavailable',
  };
}

function emptyPnlCurve(): PortfolioPnlCurve {
  return {
    status: 'empty',
    underlying: null,
    currentSpotUsd: null,
    breakEvenPricesUsd: [],
    maxProfitUsd: null,
    maxLossUsd: null,
    upsideBounded: false,
    downsideBounded: false,
    points: [],
  };
}

export class PortfolioRuntime {
  private readonly accountId: string;
  private readonly store: PositionStore;
  private readonly markProvider: MarkProvider;
  private readonly chainSurface: ChainSurfaceProvider | undefined;
  private readonly listeners = new Set<PortfolioRuntimeListener>();
  private readonly now: () => number;
  private readonly underlyingFilter: string | undefined;

  private pushTimer: ReturnType<typeof setInterval> | null = null;
  private storeUnsubscribe: (() => void) | null = null;
  private chainUnsubscribe: (() => void) | null = null;

  private forwardDays: number;
  private seq = 0;
  private dirty = false;
  private pendingChangedLegIds = new Set<string>();
  private lastSnapshot: PortfolioSnapshotEvent | null = null;
  private disposed = false;

  private readonly firstSeenIv = new Map<string, number>();

  constructor(options: PortfolioRuntimeOptions) {
    this.accountId = options.accountId;
    this.store = options.store;
    this.markProvider = options.markProvider;
    this.chainSurface = options.chainSurface;
    this.forwardDays = options.forwardDays ?? 0;
    this.now = options.now ?? Date.now;
    this.underlyingFilter = options.underlyingFilter;
  }

  start(): void {
    if (this.disposed) return;
    if (this.pushTimer != null) return;

    this.storeUnsubscribe = this.store.subscribe((event) => {
      if (event.accountId !== this.accountId) return;
      for (const id of event.changedLegIds) this.pendingChangedLegIds.add(id);
      this.dirty = true;
    });

    if (this.chainSurface != null) {
      this.chainUnsubscribe = this.chainSurface.subscribeChainTicks(() => {
        this.dirty = true;
      });
    }

    this.emitSnapshot();
    this.pushTimer = setInterval(() => {
      if (this.disposed || !this.dirty) return;
      this.dirty = false;
      this.emitDelta();
    }, PUSH_INTERVAL_MS);
  }

  setForwardDays(forwardDays: number): void {
    if (forwardDays === this.forwardDays) return;
    this.forwardDays = forwardDays;
    this.dirty = true;
  }

  subscribe(listener: PortfolioRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): PortfolioSnapshotEvent | null {
    return this.lastSnapshot;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pushTimer != null) {
      clearInterval(this.pushTimer);
      this.pushTimer = null;
    }
    this.storeUnsubscribe?.();
    this.chainUnsubscribe?.();
    this.listeners.clear();
  }

  private buildMetrics(): { positions: PositionLeg[]; metrics: PortfolioMetrics } {
    const storeList = this.store.list(this.accountId);
    const rawPositions =
      this.underlyingFilter == null
        ? storeList
        : storeList.filter((leg) => leg.underlying === this.underlyingFilter);
    const rawMarks = rawPositions.map((leg) => this.markProvider(leg));

    // Capture the first live IV we see per leg as an entryIv proxy for
    // venue-imported positions (which never carry historical entry IV).
    // Once captured the value sticks, so the "entry IV" column doesn't
    // drift with the live mark.
    for (let i = 0; i < rawPositions.length; i += 1) {
      const leg = rawPositions[i];
      if (leg == null || leg.entryIv != null) continue;
      const mark = rawMarks[i];
      if (
        mark != null &&
        mark.iv != null &&
        Number.isFinite(mark.iv) &&
        mark.iv > 0 &&
        !this.firstSeenIv.has(leg.legId)
      ) {
        this.firstSeenIv.set(leg.legId, mark.iv);
      }
    }

    const liveIds = new Set(rawPositions.map((leg) => leg.legId));
    for (const id of [...this.firstSeenIv.keys()]) {
      if (!liveIds.has(id)) this.firstSeenIv.delete(id);
    }

    const positions = rawPositions.map((leg) => {
      if (leg.entryIv != null) return leg;
      const cached = this.firstSeenIv.get(leg.legId);
      return cached != null ? { ...leg, entryIv: cached } : leg;
    });

    const withMarks = positions.map((leg, i) => {
      const mark = rawMarks[i];
      if (mark == null) throw new Error('mark missing for leg');
      return { leg, mark };
    });
    const nowMs = this.now() + this.forwardDays * 86_400_000;

    let totals: PortfolioTotals;
    let pnlCurve: PortfolioPnlCurve;
    let byStrike: VegaByStrikeRow[];
    let byExpiry: ExpiryBucketRow[];
    let breakEven: BreakEvenIvRow[];
    let shockGrid: ShockGridCell[][];
    let shockGridMeta: ShockGridMeta;
    let strategies: StrategyGroup[];

    if (positions.length === 0) {
      totals = emptyTotals();
      pnlCurve = emptyPnlCurve();
      byStrike = [];
      byExpiry = [];
      breakEven = [];
      shockGrid = [];
      shockGridMeta = {
        totalLegs: 0,
        pricedLegs: 0,
        excludedLegIds: [],
        anchor: 'per_leg_forward',
      };
      strategies = [];
    } else {
      totals = computeTotals(withMarks);
      pnlCurve = buildPortfolioPnlCurve(withMarks, this.now(), this.forwardDays);
      byStrike = aggregateGreeksByStrike(withMarks);
      byExpiry = aggregateGreeksByExpiry(withMarks, nowMs);
      breakEven = breakEvenIvCurve(withMarks);
      shockGrid = computeShockGrid(withMarks, nowMs);
      shockGridMeta = getShockGridMeta(withMarks);
      strategies = detectStrategyGroups(
        positions,
        new Map(withMarks.map(({ leg, mark }) => [leg.legId, mark])),
      );
    }

    const accounting =
      this.store.getAccounting?.(this.accountId, this.underlyingFilter) ??
      positionAccounting(positions);
    const metrics: PortfolioMetrics = {
      accountId: this.accountId,
      generatedAt: this.now(),
      forwardDays: this.forwardDays,
      totals,
      pnlCurve,
      byStrike,
      byExpiry,
      breakEven,
      shockGrid,
      shockGridMeta,
      strategies,
      accounting,
    };
    return { positions, metrics };
  }

  private buildMetricsSafe(): {
    positions: PositionLeg[];
    metrics: PortfolioMetrics;
    error: PortfolioErrorEvent | null;
  } {
    try {
      return {
        ...this.buildMetrics(),
        error: null,
      };
    } catch (err: unknown) {
      logger.error({ err, accountId: this.accountId }, 'portfolio metrics build failed');
      const positions = this.store.list(this.accountId);
      const metrics: PortfolioMetrics = {
        accountId: this.accountId,
        generatedAt: this.now(),
        forwardDays: this.forwardDays,
        totals: emptyTotals(),
        pnlCurve: emptyPnlCurve(),
        byStrike: [],
        byExpiry: [],
        breakEven: [],
        shockGrid: [],
        shockGridMeta: {
          totalLegs: positions.length,
          pricedLegs: 0,
          excludedLegIds: positions.map((leg) => leg.legId),
          anchor: 'per_leg_forward',
        },
        strategies: [],
        accounting:
          this.store.getAccounting?.(this.accountId, this.underlyingFilter) ??
          positionAccounting(positions),
      };
      return {
        positions,
        metrics,
        error: {
          type: 'error',
          code: 'portfolio_metrics_failed',
          message: err instanceof Error ? err.message : 'portfolio metrics build failed',
        },
      };
    }
  }

  private emitSnapshot(): void {
    const { positions, metrics, error } = this.buildMetricsSafe();
    this.seq += 1;
    const event: PortfolioSnapshotEvent = {
      type: 'snapshot',
      seq: this.seq,
      positions,
      metrics,
    };
    this.lastSnapshot = event;
    this.pendingChangedLegIds.clear();
    this.broadcast(event);
    if (error != null) this.broadcast(error);
  }

  private emitDelta(): void {
    const { positions, metrics, error } = this.buildMetricsSafe();
    this.seq += 1;
    const changedLegIds = [...this.pendingChangedLegIds];
    this.pendingChangedLegIds.clear();
    const snapshot: PortfolioSnapshotEvent = {
      type: 'snapshot',
      seq: this.seq,
      positions,
      metrics,
    };
    this.lastSnapshot = snapshot;
    const event: PortfolioDeltaEvent = {
      type: 'delta',
      seq: this.seq,
      metrics,
      changedLegIds,
    };
    this.broadcast(event);
    if (error != null) this.broadcast(error);
  }

  private broadcast(event: PortfolioRuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.onEvent(event);
      } catch (err) {
        logger.error(
          { err, accountId: this.accountId, eventType: event.type },
          'portfolio runtime listener failed',
        );
      }
    }
  }
}
