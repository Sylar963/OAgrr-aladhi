import type { PositionLeg } from '@oggregator/core';
import type { BroadcasterRow, PersistedExchangeTrade, SocialStore } from '@oggregator/db';
import type { EquityHistoryPoint, LeaderboardPeriod, SocialVenue } from '@oggregator/protocol';

import { toDailyCloses } from './equity-daily-closes.js';

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 365;
const HISTORY_TTL_MS = 5 * 60_000;
const RESTORE_RETRY_MS = 30 * 60_000;
const MAINTENANCE_INTERVAL_MS = 10 * 60_000;
const STARTUP_DELAY_MS = 30_000;

export type Broadcaster = BroadcasterRow;

export type RestoreOutcome = 'connected' | 'not_connected' | 'removed';

/** The slice of the private venue stores the leaderboard needs. */
export interface VenueAccountAccess {
  isConnected(accountId: string, venue: SocialVenue): boolean;
  /** Reconnects from the user's stored, encrypted credentials. */
  restore(accountId: string, venue: SocialVenue): Promise<RestoreOutcome>;
  keepAlive(accountId: string, venue: SocialVenue, enabled: boolean): void;
  listLegs(accountId: string, venue: SocialVenue): PositionLeg[];
  fetchEquityHistory(
    accountId: string,
    venue: SocialVenue,
    fromMs: number,
  ): Promise<EquityHistoryPoint[] | null>;
  /** Newest first; null when the venue keeps no fill ledger. */
  loadTrades(
    accountId: string,
    venue: SocialVenue,
    limit: number,
  ): Promise<PersistedExchangeTrade[] | null>;
  subscribe(listener: (accountId: string, venue: SocialVenue) => void): () => void;
}

interface Logger {
  warn: (obj: object, msg: string) => void;
}

function connectionKey(row: { accountId: string; venue: SocialVenue }): string {
  return `${row.accountId}|${row.venue}`;
}

/**
 * Leaderboard members and their venue connections. The member list is read once and reloaded only
 * after a profile change in this process. Members' connections are pinned open so their book keeps
 * streaming after they close the browser, and are restored from stored credentials after a restart.
 */
export class BroadcastRegistry {
  private rows: Broadcaster[] | null = null;
  private inflight: Promise<Broadcaster[]> | null = null;
  private generation = 0;
  private readonly kept = new Map<string, Broadcaster>();
  private readonly lastRestoreAt = new Map<string, number>();
  private readonly restoring = new Map<string, Promise<void>>();
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: Pick<SocialStore, 'listBroadcasters'>,
    private readonly access: VenueAccountAccess,
    private readonly log: Logger,
    private readonly onConnected: () => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (this.startTimer || this.maintenanceTimer) return;
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      void this.all().catch((err: unknown) => {
        this.log.warn({ err: String(err) }, 'leaderboard members load failed');
      });
    }, STARTUP_DELAY_MS);
    this.startTimer.unref?.();
    this.maintenanceTimer = setInterval(() => this.reconnectMissing(), MAINTENANCE_INTERVAL_MS);
    this.maintenanceTimer.unref?.();
  }

  invalidate(): void {
    this.rows = null;
    this.generation += 1;
  }

  async all(): Promise<Broadcaster[]> {
    if (this.rows) return this.rows;
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    this.inflight = this.store
      .listBroadcasters()
      .then((rows) => {
        if (generation === this.generation) this.rows = rows;
        this.sync(rows);
        return rows;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Members whose venue account is connected right now. */
  async live(): Promise<Broadcaster[]> {
    const rows = await this.all();
    return rows.filter((row) => this.access.isConnected(row.accountId, row.venue));
  }

  async find(handle: string): Promise<{ broadcaster: Broadcaster; connected: boolean } | null> {
    const wanted = handle.toLowerCase();
    const broadcaster = (await this.all()).find((row) => row.handle.toLowerCase() === wanted);
    if (!broadcaster) return null;
    return {
      broadcaster,
      connected: this.access.isConnected(broadcaster.accountId, broadcaster.venue),
    };
  }

  /** Resolves once in-flight reconnects settle; for tests and shutdown. */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.restoring.values()]);
  }

  dispose(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.startTimer = null;
    this.maintenanceTimer = null;
    for (const row of this.kept.values()) this.access.keepAlive(row.accountId, row.venue, false);
    this.kept.clear();
  }

  private sync(rows: Broadcaster[]): void {
    const next = new Map(rows.map((row) => [connectionKey(row), row]));
    for (const [key, row] of this.kept) {
      if (next.has(key)) continue;
      this.access.keepAlive(row.accountId, row.venue, false);
      this.kept.delete(key);
    }
    for (const [key, row] of next) {
      if (!this.kept.has(key)) this.access.keepAlive(row.accountId, row.venue, true);
      this.kept.set(key, row);
    }
    this.reconnectMissing();
  }

  private reconnectMissing(): void {
    for (const [key, row] of this.kept) {
      if (this.access.isConnected(row.accountId, row.venue) || this.restoring.has(key)) continue;
      const last = this.lastRestoreAt.get(key);
      if (last != null && this.now() - last < RESTORE_RETRY_MS) continue;
      this.lastRestoreAt.set(key, this.now());
      const task = this.access
        .restore(row.accountId, row.venue)
        .then((outcome) => {
          if (outcome === 'connected') this.onConnected();
        })
        .catch((err: unknown) => {
          this.log.warn(
            { venue: row.venue, handle: row.handle, err: String(err) },
            'leaderboard venue reconnect failed',
          );
        })
        .finally(() => {
          this.restoring.delete(key);
        });
      this.restoring.set(key, task);
    }
  }
}

export interface VenueEquity {
  fetchedAt: number;
  /** Daily closes, oldest first. */
  points: EquityHistoryPoint[];
}

/** One venue history call per account per five minutes, shared by the leaderboard and watchers. */
export class VenueEquityCache {
  private readonly cache = new Map<string, VenueEquity>();
  private readonly inflight = new Map<string, Promise<VenueEquity | null>>();

  constructor(
    private readonly access: Pick<VenueAccountAccess, 'fetchEquityHistory'>,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = HISTORY_TTL_MS,
  ) {}

  peek(accountId: string, venue: SocialVenue): VenueEquity | null {
    return this.cache.get(connectionKey({ accountId, venue })) ?? null;
  }

  get(accountId: string, venue: SocialVenue): Promise<VenueEquity | null> {
    const key = connectionKey({ accountId, venue });
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.fetchedAt < this.ttlMs) return Promise.resolve(cached);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const nowMs = this.now();
    const request = this.access
      .fetchEquityHistory(accountId, venue, nowMs - HISTORY_DAYS * DAY_MS)
      .then((points) => {
        if (points == null) {
          this.cache.delete(key);
          return null;
        }
        const entry = { fetchedAt: nowMs, points: toDailyCloses(points) };
        this.cache.set(key, entry);
        return entry;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }
}

export interface EquitySummary {
  equityUsd: number;
  equityAsOf: number;
  baselineUsd: number;
  since: number;
  pnlUsd: number;
  returnPct: number;
}

/**
 * Change in venue-reported equity over a period. The baseline is the last close at or before the
 * period start, or the first funded close for younger accounts. Deposits and withdrawals count,
 * because venues report account value rather than trading PnL.
 */
export function summarizeEquity(
  points: readonly EquityHistoryPoint[],
  period: LeaderboardPeriod,
  nowMs: number,
): EquitySummary | null {
  const firstFunded = points.findIndex((point) => point.equityUsd > 0);
  if (firstFunded < 0) return null;
  const funded = points.slice(firstFunded);
  const latest = funded[funded.length - 1]!;
  let baseline = funded[0]!;
  if (period !== 'all') {
    const fromMs = nowMs - (period === '7d' ? 7 : 30) * DAY_MS;
    baseline = funded.filter((point) => point.ts <= fromMs).at(-1) ?? baseline;
  }
  const pnlUsd = latest.equityUsd - baseline.equityUsd;
  return {
    equityUsd: latest.equityUsd,
    equityAsOf: latest.ts,
    baselineUsd: baseline.equityUsd,
    since: baseline.ts,
    pnlUsd,
    returnPct: pnlUsd / baseline.equityUsd,
  };
}
