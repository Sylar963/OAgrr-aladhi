import type { PositionLeg } from '@oggregator/core';
import type {
  ChatServerMessage,
  PublicClosedTradeDto,
  PublicPositionDto,
  SocialVenue,
  TraderLiveDto,
} from '@oggregator/protocol';

import { type Broadcaster, summarizeEquity, type VenueEquity } from './social-broadcast.js';
import type { MarkLookup } from './social-leaderboard.js';

export type TraderTarget = Broadcaster;

export interface TraderWatcher {
  userId: string;
  send: (message: ChatServerMessage) => void;
}

export interface TraderStreamDeps {
  isConnected: (target: TraderTarget) => boolean;
  loadEquity: (target: TraderTarget) => Promise<VenueEquity | null>;
  listLegs: (target: TraderTarget) => PositionLeg[];
  /** Null when the venue keeps no fill history. */
  loadClosedTrades: (target: TraderTarget) => Promise<PublicClosedTradeDto[] | null>;
  getMark: MarkLookup;
  now?: () => number;
  tickMs?: number;
  reloadDebounceMs?: number;
  idleRetentionMs?: number;
  equityRefreshMs?: number;
}

interface TraderData {
  equity: VenueEquity;
  closedTrades: PublicClosedTradeDto[] | null;
}

interface TraderEntry {
  target: TraderTarget;
  watchers: Set<TraderWatcher>;
  data: TraderData | null;
  loading: Promise<void> | null;
  refreshing: boolean;
  reloadTimer: ReturnType<typeof setTimeout> | null;
  idleSince: number | null;
}

function entryKey(target: { accountId: string; venue: SocialVenue }): string {
  return `${target.accountId}|${target.venue}`;
}

/**
 * Streams a leaderboard member's venue account to watchers. Positions come from the live venue
 * connection and are re-marked every two seconds; equity history is the venue's own, refreshed
 * every five minutes; closing fills are re-read from the ledger only after that account changes.
 */
export class TraderStreamService {
  private readonly entries = new Map<string, TraderEntry>();
  private readonly watching = new Map<TraderWatcher, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly tickMs: number;
  private readonly reloadDebounceMs: number;
  private readonly idleRetentionMs: number;
  private readonly equityRefreshMs: number;

  constructor(private readonly deps: TraderStreamDeps) {
    this.now = deps.now ?? Date.now;
    this.tickMs = deps.tickMs ?? 2_000;
    this.reloadDebounceMs = deps.reloadDebounceMs ?? 1_000;
    this.idleRetentionMs = deps.idleRetentionMs ?? 60_000;
    this.equityRefreshMs = deps.equityRefreshMs ?? 5 * 60_000;
  }

  async watch(watcher: TraderWatcher, target: TraderTarget): Promise<void> {
    this.unwatch(watcher);
    if (!this.deps.isConnected(target)) {
      watcher.send({ type: 'trader_unavailable', handle: target.handle, reason: 'waiting' });
      return;
    }
    const key = entryKey(target);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        target,
        watchers: new Set(),
        data: null,
        loading: null,
        refreshing: false,
        reloadTimer: null,
        idleSince: null,
      };
      this.entries.set(key, entry);
    }
    entry.target = target;
    entry.watchers.add(watcher);
    entry.idleSince = null;
    this.watching.set(watcher, key);
    this.ensureTimer();
    try {
      await this.ensureLoaded(entry);
    } catch (err) {
      this.unwatch(watcher);
      throw err;
    }
    if (!entry.data) {
      this.unwatch(watcher);
      watcher.send({ type: 'trader_unavailable', handle: target.handle, reason: 'waiting' });
      return;
    }
    if (entry.watchers.has(watcher)) await this.sendFull(entry, [watcher]);
  }

  unwatch(watcher: TraderWatcher): void {
    const key = this.watching.get(watcher);
    if (key == null) return;
    this.watching.delete(watcher);
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.watchers.delete(watcher);
    if (entry.watchers.size === 0) entry.idleSince = this.now();
  }

  /** Stops every stream of a member who left the leaderboard or changed username or venue. */
  revoke(userId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.target.userId !== userId) continue;
      this.endStreams(key, entry, 'left');
    }
  }

  onAccountEvent(accountId: string, venue: SocialVenue): void {
    const entry = this.entries.get(entryKey({ accountId, venue }));
    if (!entry || entry.reloadTimer) return;
    entry.reloadTimer = setTimeout(() => {
      entry.reloadTimer = null;
      if (entry.watchers.size === 0 || !entry.data) return;
      void this.deps
        .loadClosedTrades(entry.target)
        .then(async (closedTrades) => {
          if (!entry.data || closedTrades == null) return;
          entry.data = { ...entry.data, closedTrades };
          await this.sendFull(entry, [...entry.watchers]);
        })
        .catch(() => {});
    }, this.reloadDebounceMs);
    entry.reloadTimer.unref?.();
  }

  get watchedCount(): number {
    return this.entries.size;
  }

  async tick(): Promise<void> {
    const nowMs = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.watchers.size === 0) {
        if (entry.idleSince != null && nowMs - entry.idleSince >= this.idleRetentionMs) {
          this.drop(key, entry);
        }
        continue;
      }
      if (!entry.data) continue;
      if (!this.deps.isConnected(entry.target)) {
        this.endStreams(key, entry, 'waiting');
        continue;
      }
      if (nowMs - entry.data.equity.fetchedAt >= this.equityRefreshMs) this.refreshEquity(entry);
      const live = await this.computeLive(entry.target, entry.data);
      for (const watcher of entry.watchers) watcher.send({ type: 'trader_live', live });
    }
    if (this.entries.size === 0) this.stopTimer();
  }

  dispose(): void {
    for (const [key, entry] of this.entries) this.drop(key, entry);
    this.watching.clear();
    this.stopTimer();
  }

  private ensureLoaded(entry: TraderEntry): Promise<void> {
    if (entry.data) return Promise.resolve();
    if (entry.loading) return entry.loading;
    entry.loading = (async () => {
      const [equity, closedTrades] = await Promise.all([
        this.deps.loadEquity(entry.target),
        this.deps.loadClosedTrades(entry.target),
      ]);
      if (equity) entry.data = { equity, closedTrades };
    })().finally(() => {
      entry.loading = null;
    });
    return entry.loading;
  }

  private refreshEquity(entry: TraderEntry): void {
    if (entry.refreshing) return;
    entry.refreshing = true;
    void this.deps
      .loadEquity(entry.target)
      .then(async (equity) => {
        if (!equity || !entry.data || equity.fetchedAt === entry.data.equity.fetchedAt) return;
        entry.data = { ...entry.data, equity };
        await this.sendFull(entry, [...entry.watchers]);
      })
      .catch(() => {})
      .finally(() => {
        entry.refreshing = false;
      });
  }

  private async sendFull(entry: TraderEntry, watchers: TraderWatcher[]): Promise<void> {
    if (!entry.data || watchers.length === 0) return;
    const { equity, closedTrades } = entry.data;
    const live = await this.computeLive(entry.target, entry.data);
    const firstFunded = equity.points.findIndex((point) => point.equityUsd > 0);
    const funded = firstFunded < 0 ? [] : equity.points.slice(firstFunded);
    const startedAt = new Date(funded[0]?.ts ?? equity.fetchedAt).toISOString();
    const sharingSince = entry.target.sharingSince.toISOString();
    const equityHistory = funded.map((point) => ({
      ts: new Date(point.ts).toISOString(),
      equityUsd: point.equityUsd,
    }));
    for (const watcher of watchers) {
      watcher.send({
        type: 'trader',
        trader: {
          ...live,
          isMe: watcher.userId === entry.target.userId,
          startedAt,
          sharingSince,
          equityHistory,
          closedTrades: closedTrades ?? [],
          closedTradesAvailable: closedTrades != null,
        },
      });
    }
  }

  private async computeLive(target: TraderTarget, data: TraderData): Promise<TraderLiveDto> {
    const legs = [...this.deps.listLegs(target)].sort(
      (a, b) =>
        a.underlying.localeCompare(b.underlying) ||
        a.expiry.localeCompare(b.expiry) ||
        a.strike - b.strike ||
        a.optionRight.localeCompare(b.optionRight),
    );
    const marks = await Promise.all(
      legs.map((leg) =>
        leg.venueMarkPriceUsd != null
          ? leg.venueMarkPriceUsd
          : this.deps
              .getMark({
                underlying: leg.underlying,
                expiry: leg.expiry,
                strike: leg.strike,
                optionRight: leg.optionRight,
              })
              .catch(() => null),
      ),
    );
    const openPositions: PublicPositionDto[] = legs.map((leg, index) => {
      const mark = marks[index] ?? null;
      return {
        underlying: leg.underlying,
        expiry: leg.expiry,
        strike: leg.strike,
        optionRight: leg.optionRight,
        netQuantity: leg.size,
        avgEntryPriceUsd: leg.entryPriceUsd,
        markPriceUsd: mark,
        unrealizedPnlUsd: mark == null ? null : leg.size * (mark - leg.entryPriceUsd),
      };
    });
    const nowMs = this.now();
    const summary = summarizeEquity(data.equity.points, 'all', nowMs);
    return {
      handle: target.handle,
      venue: target.venue,
      equityUsd: summary?.equityUsd ?? 0,
      equityAsOf: new Date(summary?.equityAsOf ?? data.equity.fetchedAt).toISOString(),
      pnlUsd: summary?.pnlUsd ?? 0,
      returnPct: summary?.returnPct ?? 0,
      openPositions,
      generatedAt: new Date(nowMs).toISOString(),
    };
  }

  private endStreams(key: string, entry: TraderEntry, reason: 'left' | 'waiting'): void {
    for (const watcher of entry.watchers) {
      this.watching.delete(watcher);
      watcher.send({ type: 'trader_unavailable', handle: entry.target.handle, reason });
    }
    this.drop(key, entry);
  }

  private drop(key: string, entry: TraderEntry): void {
    if (entry.reloadTimer) clearTimeout(entry.reloadTimer);
    entry.watchers.clear();
    this.entries.delete(key);
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => {}), this.tickMs);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
