import type { AccountBookRow, PaperEquitySnapshotRow, SocialStore } from '@oggregator/db';
import type {
  LeaderboardEntryDto,
  LeaderboardPeriod,
  LeaderboardResponse,
} from '@oggregator/protocol';

const DAY_MS = 86_400_000;
const LEADERBOARD_TTL_MS = 5 * 60_000;
const LEADERBOARD_MAX_ENTRIES = 100;

export type MarkLookup = (key: {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}) => Promise<number | null>;

export interface MarkedBook {
  book: AccountBookRow;
  equityUsd: number;
  openPositions: number;
  unmarkedPositions: number;
}

interface RankedEntry extends Omit<LeaderboardEntryDto, 'isMe'> {
  userId: string;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Unmarked legs fall back to entry price so an illiquid short cannot show its premium as profit. */
export async function markBook(book: AccountBookRow, getMark: MarkLookup): Promise<MarkedBook> {
  const marks = await Promise.all(
    book.positions.map((pos) =>
      getMark({
        underlying: pos.underlying,
        expiry: pos.expiry,
        strike: pos.strike,
        optionRight: pos.optionRight,
      }).catch(() => null),
    ),
  );
  let inventoryUsd = 0;
  let unmarkedPositions = 0;
  for (const [index, pos] of book.positions.entries()) {
    const mark = marks[index] ?? null;
    if (mark == null) unmarkedPositions += 1;
    inventoryUsd += pos.netQuantity * (mark ?? pos.avgEntryPriceUsd);
  }
  return {
    book,
    equityUsd: book.cashUsd + inventoryUsd,
    openPositions: book.positions.length,
    unmarkedPositions,
  };
}

export function periodStartDay(period: Exclude<LeaderboardPeriod, 'all'>, nowMs: number): string {
  const days = period === '7d' ? 7 : 30;
  return utcDay(nowMs - days * DAY_MS);
}

/**
 * Baseline equity for a period. Accounts created or reset inside the window start from their
 * initial cash; older accounts use their earliest snapshot in the window, or drop out if none.
 */
export function periodBaseline(
  marked: MarkedBook,
  fromDay: string | null,
  snapshot: PaperEquitySnapshotRow | undefined,
): number | null {
  if (fromDay == null) return marked.book.initialCashUsd;
  if (utcDay(marked.book.accountCreatedAt.getTime()) >= fromDay) {
    return marked.book.initialCashUsd;
  }
  return snapshot?.equityUsd ?? null;
}

export function rankEntries(
  marked: MarkedBook[],
  baselines: Map<string, number | null>,
): RankedEntry[] {
  const rows: Array<Omit<RankedEntry, 'rank'>> = [];
  for (const item of marked) {
    const baseline = baselines.get(item.book.accountId);
    if (baseline == null || baseline <= 0 || item.book.handle == null) continue;
    const pnlUsd = item.equityUsd - baseline;
    rows.push({
      userId: item.book.userId,
      handle: item.book.handle,
      equityUsd: item.equityUsd,
      pnlUsd,
      returnPct: pnlUsd / baseline,
      openPositions: item.openPositions,
      unmarkedPositions: item.unmarkedPositions,
    });
  }
  rows.sort((a, b) => b.returnPct - a.returnPct || b.pnlUsd - a.pnlUsd);
  return rows.slice(0, LEADERBOARD_MAX_ENTRIES).map((row, index) => ({ ...row, rank: index + 1 }));
}

interface LeaderboardCache {
  generatedAt: number;
  marked: MarkedBook[];
  ranked: Map<LeaderboardPeriod, Promise<RankedEntry[]>>;
}

/**
 * Computed on demand and cached for five minutes, so an idle leaderboard never touches the database
 * and an active one costs one book query plus one baseline query per period per window.
 */
export class LeaderboardService {
  private current: LeaderboardCache | null = null;
  private inflight: Promise<LeaderboardCache> | null = null;
  private generation = 0;

  constructor(
    private readonly store: Pick<SocialStore, 'listAccountBooks' | 'listEquityBaselines'>,
    private readonly getMark: MarkLookup,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = LEADERBOARD_TTL_MS,
  ) {}

  invalidate(): void {
    this.current = null;
    this.generation += 1;
  }

  /** Resolves a handle to an opted-in trader from the cached books, without a query of its own. */
  async findVisible(
    handle: string,
  ): Promise<{ userId: string; accountId: string; handle: string } | null> {
    const cache = await this.load();
    const wanted = handle.toLowerCase();
    const match = cache.marked.find((item) => item.book.handle?.toLowerCase() === wanted);
    if (!match?.book.handle) return null;
    return {
      userId: match.book.userId,
      accountId: match.book.accountId,
      handle: match.book.handle,
    };
  }

  async get(period: LeaderboardPeriod, viewerUserId: string | null): Promise<LeaderboardResponse> {
    const cache = await this.load();
    let ranked = cache.ranked.get(period);
    if (!ranked) {
      ranked = this.rank(cache, period);
      cache.ranked.set(period, ranked);
      ranked.catch(() => cache.ranked.delete(period));
    }
    const entries = await ranked;
    return {
      period,
      generatedAt: new Date(cache.generatedAt).toISOString(),
      entries: entries.map(({ userId, ...entry }) => ({ ...entry, isMe: userId === viewerUserId })),
    };
  }

  private load(): Promise<LeaderboardCache> {
    if (this.current && this.now() - this.current.generatedAt < this.ttlMs) {
      return Promise.resolve(this.current);
    }
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    this.inflight = (async () => {
      const books = await this.store.listAccountBooks({ leaderboardOnly: true });
      const marked = await Promise.all(books.map((book) => markBook(book, this.getMark)));
      const next: LeaderboardCache = { generatedAt: this.now(), marked, ranked: new Map() };
      // A profile change during the load must not be hidden behind this result for a full TTL.
      if (generation === this.generation) this.current = next;
      return next;
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async rank(cache: LeaderboardCache, period: LeaderboardPeriod): Promise<RankedEntry[]> {
    const baselines = new Map<string, number | null>();
    if (period === 'all') {
      for (const item of cache.marked) {
        baselines.set(item.book.accountId, periodBaseline(item, null, undefined));
      }
      return rankEntries(cache.marked, baselines);
    }
    const fromDay = periodStartDay(period, cache.generatedAt);
    const needsSnapshot = cache.marked.filter(
      (item) => utcDay(item.book.accountCreatedAt.getTime()) < fromDay,
    );
    const snapshots = await this.store.listEquityBaselines(
      needsSnapshot.map((item) => item.book.accountId),
      fromDay,
    );
    const byAccount = new Map(snapshots.map((row) => [row.accountId, row]));
    for (const item of cache.marked) {
      baselines.set(
        item.book.accountId,
        periodBaseline(item, fromDay, byAccount.get(item.book.accountId)),
      );
    }
    return rankEntries(cache.marked, baselines);
  }
}

/** Marks every user's default account and writes one snapshot row each for `day`. */
export async function captureEquitySnapshots(
  store: Pick<SocialStore, 'listAccountBooks' | 'upsertEquitySnapshots'>,
  getMark: MarkLookup,
  nowMs: number,
): Promise<number> {
  const books = await store.listAccountBooks({ leaderboardOnly: false });
  const marked = await Promise.all(books.map((book) => markBook(book, getMark)));
  const day = utcDay(nowMs);
  const capturedAt = new Date(nowMs);
  return store.upsertEquitySnapshots(
    marked.map((item) => ({
      accountId: item.book.accountId,
      day,
      equityUsd: item.equityUsd,
      capturedAt,
    })),
  );
}
