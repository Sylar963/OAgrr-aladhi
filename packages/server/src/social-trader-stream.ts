import type { AccountBookRow, PaperEquitySnapshotRow } from '@oggregator/db';
import type {
  ChatServerMessage,
  PublicClosedTradeDto,
  PublicPositionDto,
  TraderLiveDto,
} from '@oggregator/protocol';

import type { MarkLookup } from './social-leaderboard.js';

export interface TraderTarget {
  userId: string;
  accountId: string;
  handle: string;
}

export interface TraderWatcher {
  userId: string;
  send: (message: ChatServerMessage) => void;
}

export interface TraderStreamDeps {
  loadBook: (accountId: string) => Promise<AccountBookRow | null>;
  loadClosedTrades: (accountId: string) => Promise<PublicClosedTradeDto[]>;
  loadEquityHistory: (accountId: string) => Promise<PaperEquitySnapshotRow[]>;
  getMark: MarkLookup;
  now?: () => number;
  tickMs?: number;
  reloadDebounceMs?: number;
  idleRetentionMs?: number;
}

interface TraderData {
  book: AccountBookRow;
  closedTrades: PublicClosedTradeDto[];
  equityHistory: PaperEquitySnapshotRow[];
}

interface TraderEntry {
  target: TraderTarget;
  watchers: Set<TraderWatcher>;
  data: TraderData | null;
  loading: Promise<void> | null;
  reloadTimer: ReturnType<typeof setTimeout> | null;
  idleSince: number | null;
}

/**
 * Streams a leaderboard trader's book to watchers. The database is read when a trader is first
 * watched and again only after one of their own orders or trades; the two-second live frames
 * re-mark the cached book from in-memory quotes.
 */
export class TraderStreamService {
  private readonly entries = new Map<string, TraderEntry>();
  private readonly watching = new Map<TraderWatcher, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly tickMs: number;
  private readonly reloadDebounceMs: number;
  private readonly idleRetentionMs: number;

  constructor(private readonly deps: TraderStreamDeps) {
    this.now = deps.now ?? Date.now;
    this.tickMs = deps.tickMs ?? 2_000;
    this.reloadDebounceMs = deps.reloadDebounceMs ?? 1_000;
    this.idleRetentionMs = deps.idleRetentionMs ?? 60_000;
  }

  async watch(watcher: TraderWatcher, target: TraderTarget): Promise<void> {
    this.unwatch(watcher);
    let entry = this.entries.get(target.accountId);
    if (!entry) {
      entry = {
        target,
        watchers: new Set(),
        data: null,
        loading: null,
        reloadTimer: null,
        idleSince: null,
      };
      this.entries.set(target.accountId, entry);
    }
    entry.target = target;
    entry.watchers.add(watcher);
    entry.idleSince = null;
    this.watching.set(watcher, target.accountId);
    this.ensureTimer();
    try {
      await this.ensureLoaded(entry);
    } catch (err) {
      this.unwatch(watcher);
      throw err;
    }
    if (entry.watchers.has(watcher)) await this.sendFull(entry, [watcher]);
  }

  unwatch(watcher: TraderWatcher): void {
    const accountId = this.watching.get(watcher);
    if (accountId == null) return;
    this.watching.delete(watcher);
    const entry = this.entries.get(accountId);
    if (!entry) return;
    entry.watchers.delete(watcher);
    if (entry.watchers.size === 0) entry.idleSince = this.now();
  }

  /** Stops every stream of a trader who left the leaderboard or changed username. */
  revoke(userId: string): void {
    for (const [accountId, entry] of this.entries) {
      if (entry.target.userId !== userId) continue;
      for (const watcher of entry.watchers) {
        this.watching.delete(watcher);
        watcher.send({ type: 'trader_unavailable', handle: entry.target.handle });
      }
      this.drop(accountId, entry);
    }
  }

  onAccountEvent(accountId: string): void {
    const entry = this.entries.get(accountId);
    if (!entry || entry.reloadTimer) return;
    entry.reloadTimer = setTimeout(() => {
      entry.reloadTimer = null;
      if (entry.watchers.size === 0) {
        entry.data = null;
        return;
      }
      void this.reload(entry)
        .then(() => this.sendFull(entry, [...entry.watchers]))
        .catch(() => {});
    }, this.reloadDebounceMs);
    entry.reloadTimer.unref?.();
  }

  get watchedCount(): number {
    return this.entries.size;
  }

  async tick(): Promise<void> {
    const nowMs = this.now();
    for (const [accountId, entry] of this.entries) {
      if (entry.watchers.size === 0) {
        if (entry.idleSince != null && nowMs - entry.idleSince >= this.idleRetentionMs) {
          this.drop(accountId, entry);
        }
        continue;
      }
      if (!entry.data) continue;
      const live = await this.computeLive(entry.target, entry.data);
      for (const watcher of entry.watchers) watcher.send({ type: 'trader_live', live });
    }
    if (this.entries.size === 0) this.stopTimer();
  }

  dispose(): void {
    for (const [accountId, entry] of this.entries) this.drop(accountId, entry);
    this.watching.clear();
    this.stopTimer();
  }

  private ensureLoaded(entry: TraderEntry): Promise<void> {
    if (entry.data) return Promise.resolve();
    return this.reload(entry);
  }

  private reload(entry: TraderEntry): Promise<void> {
    if (entry.loading) return entry.loading;
    const accountId = entry.target.accountId;
    entry.loading = (async () => {
      const [book, closedTrades, equityHistory] = await Promise.all([
        this.deps.loadBook(accountId),
        this.deps.loadClosedTrades(accountId),
        this.deps.loadEquityHistory(accountId),
      ]);
      if (!book) throw new Error(`paper account ${accountId} not found`);
      entry.data = { book, closedTrades, equityHistory };
    })().finally(() => {
      entry.loading = null;
    });
    return entry.loading;
  }

  private async sendFull(entry: TraderEntry, watchers: TraderWatcher[]): Promise<void> {
    if (!entry.data || watchers.length === 0) return;
    const { book, closedTrades, equityHistory } = entry.data;
    const live = await this.computeLive(entry.target, entry.data);
    const history = [
      { ts: book.accountCreatedAt.toISOString(), equityUsd: book.initialCashUsd },
      ...equityHistory.map((row) => ({
        ts: row.capturedAt.toISOString(),
        equityUsd: row.equityUsd,
      })),
      { ts: live.generatedAt, equityUsd: live.equityUsd },
    ];
    for (const watcher of watchers) {
      watcher.send({
        type: 'trader',
        trader: {
          ...live,
          isMe: watcher.userId === entry.target.userId,
          initialCashUsd: book.initialCashUsd,
          startedAt: book.accountCreatedAt.toISOString(),
          equityHistory: history,
          closedTrades,
        },
      });
    }
  }

  private async computeLive(target: TraderTarget, data: TraderData): Promise<TraderLiveDto> {
    const { book } = data;
    const marks = await Promise.all(
      book.positions.map((pos) =>
        this.deps
          .getMark({
            underlying: pos.underlying,
            expiry: pos.expiry,
            strike: pos.strike,
            optionRight: pos.optionRight,
          })
          .catch(() => null),
      ),
    );
    let inventoryUsd = 0;
    const openPositions: PublicPositionDto[] = book.positions.map((pos, index) => {
      const mark = marks[index] ?? null;
      inventoryUsd += pos.netQuantity * (mark ?? pos.avgEntryPriceUsd);
      return {
        underlying: pos.underlying,
        expiry: pos.expiry,
        strike: pos.strike,
        optionRight: pos.optionRight,
        netQuantity: pos.netQuantity,
        avgEntryPriceUsd: pos.avgEntryPriceUsd,
        markPriceUsd: mark,
        unrealizedPnlUsd: mark == null ? null : pos.netQuantity * (mark - pos.avgEntryPriceUsd),
      };
    });
    const equityUsd = book.cashUsd + inventoryUsd;
    const pnlUsd = equityUsd - book.initialCashUsd;
    return {
      handle: target.handle,
      equityUsd,
      pnlUsd,
      returnPct: book.initialCashUsd > 0 ? pnlUsd / book.initialCashUsd : 0,
      openPositions,
      generatedAt: new Date(this.now()).toISOString(),
    };
  }

  private drop(accountId: string, entry: TraderEntry): void {
    if (entry.reloadTimer) clearTimeout(entry.reloadTimer);
    entry.watchers.clear();
    this.entries.delete(accountId);
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
