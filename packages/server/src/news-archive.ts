import { existsSync } from 'node:fs';
import type { NewsCursor, NewsStore, PersistedNewsItem } from '@oggregator/db';
import { z } from 'zod';
import {
  appendJsonLines,
  type DeferredLog,
  describeError,
  FlushSchedule,
  readJsonLines,
  rewriteJsonLines,
  rewriteOutbox,
} from '@oggregator/db';
import type { NewsArchiveSink, NewsItem } from './news-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const NEWS_WINDOWS = ['latest', '24h', '7d', '30d', '1y'] as const;
export type NewsWindow = (typeof NEWS_WINDOWS)[number];

const WINDOW_MS: Record<NewsWindow, number | null> = {
  latest: null,
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '1y': 365 * DAY_MS,
};

const DB_PAGE_MEMO_MAX = 64;

export interface NewsArchiveOptions {
  cachePath: string;
  flushIntervalMs: number;
  // How far back the local ndjson cache reaches; pages older than this come from the delegate.
  localRetentionMs: number;
  retentionMs: number;
  maxPendingRows: number;
  flushOnDispose?: boolean;
  now?: () => number;
}

export interface NewsPageRequest {
  window: NewsWindow;
  cursor: string | null;
  limit: number;
}

export interface NewsArchivePage {
  items: NewsItem[];
  nextCursor: string | null;
}

const PersistedNewsItemSchema = z
  .object({
    id: z.string().min(1),
    publishedAt: z.string().datetime().transform((value) => new Date(value)),
    ingestedAt: z.string().datetime().transform((value) => new Date(value)),
    text: z.string(),
    url: z.string(),
    source: z.string(),
    handle: z.string().nullable(),
    ruleTag: z.string().nullable(),
  })
  .strict();

function decodeNewsItem(value: unknown): PersistedNewsItem {
  return PersistedNewsItemSchema.parse(value);
}

function encodeNewsItem(row: PersistedNewsItem) {
  return {
    ...row,
    publishedAt: row.publishedAt.toISOString(),
    ingestedAt: row.ingestedAt.toISOString(),
  };
}

function compareDesc(a: PersistedNewsItem, b: PersistedNewsItem): number {
  const dt = b.publishedAt.getTime() - a.publishedAt.getTime();
  if (dt !== 0) return dt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function isBefore(row: NewsCursor, cursor: NewsCursor): boolean {
  const dt = row.publishedAt.getTime() - cursor.publishedAt.getTime();
  return dt < 0 || (dt === 0 && row.id < cursor.id);
}

export function encodeNewsCursor(row: PersistedNewsItem): string {
  return `${row.publishedAt.getTime()}:${row.id}`;
}

export function decodeNewsCursor(raw: string): NewsCursor | null {
  const sep = raw.indexOf(':');
  if (sep <= 0 || sep === raw.length - 1) return null;
  const ms = Number(raw.slice(0, sep));
  if (!Number.isSafeInteger(ms)) return null;
  return { publishedAt: new Date(ms), id: raw.slice(sep + 1) };
}

export function toPersistedNewsItem(item: NewsItem): PersistedNewsItem {
  const ingested = Date.parse(item.createdAt);
  return {
    id: item.id,
    publishedAt: new Date(item.timestamp),
    ingestedAt: new Date(Number.isNaN(ingested) ? item.timestamp : ingested),
    text: item.text,
    url: item.url,
    source: item.source,
    handle: item.handle,
    ruleTag: item.ruleTag,
  };
}

export function toNewsItem(row: PersistedNewsItem): NewsItem {
  return {
    id: row.id,
    text: row.text,
    url: row.url,
    source: row.source,
    handle: row.handle,
    ruleTag: row.ruleTag,
    timestamp: row.publishedAt.getTime(),
    classification: 'GOOD',
    createdAt: row.ingestedAt.toISOString(),
  };
}

// The upstream feed only exposes its latest ~200 tweets, so every headline we want to keep has
// to be recorded here as it arrives. Recent history lives in a local ndjson cache that survives
// restarts and serves almost every read; Postgres (Neon) is written once per flush interval and
// only read when a reader pages past the local cache. Delegate pages are memoized until the next
// flush because flushed rows are the only thing that changes them.
export class NewsArchive implements NewsArchiveSink {
  private cache: PersistedNewsItem[];
  private readonly ids: Set<string>;
  private pending: PersistedNewsItem[];
  private readonly pendingPath: string;
  private readonly now: () => number;
  private readonly timer: FlushSchedule;
  private readonly dbPages = new Map<string, PersistedNewsItem[]>();
  private flushing = false;

  constructor(
    private readonly delegate: NewsStore,
    private readonly options: NewsArchiveOptions,
    private readonly log: DeferredLog,
  ) {
    this.now = options.now ?? Date.now;
    this.pendingPath = `${options.cachePath}.pending`;
    this.cache = readJsonLines(options.cachePath, decodeNewsItem, log).sort(compareDesc);
    this.ids = new Set(this.cache.map((row) => row.id));
    this.pending = !delegate.enabled
      ? []
      : existsSync(this.pendingPath)
        ? readJsonLines(this.pendingPath, decodeNewsItem, log)
        : [...this.cache];
    this.timer = new FlushSchedule(
      options.cachePath,
      options.flushIntervalMs,
      () => this.flush(),
      (err: unknown) => {
        this.log.warn(
          { err: describeError(err), pending: this.pending.length },
          'deferred news flush failed',
        );
      },
    );
  }

  get size(): number {
    return this.cache.length;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  recent(limit: number): NewsItem[] {
    return this.cache.slice(0, limit).map(toNewsItem);
  }

  record(items: NewsItem[]): void {
    const rows: PersistedNewsItem[] = [];
    for (const item of items) {
      if (this.ids.has(item.id)) continue;
      this.ids.add(item.id);
      rows.push(toPersistedNewsItem(item));
    }
    if (rows.length === 0) return;

    this.cache.push(...rows);
    this.cache.sort(compareDesc);
    appendJsonLines(this.options.cachePath, rows, encodeNewsItem);

    if (!this.delegate.enabled) return;
    this.pending.push(...rows);
    if (this.pending.length > this.options.maxPendingRows) {
      this.pending.splice(0, this.pending.length - this.options.maxPendingRows);
      rewriteOutbox(this.pendingPath, this.pending, encodeNewsItem);
    } else {
      appendJsonLines(this.pendingPath, rows, encodeNewsItem);
    }
  }

  async page({ window, cursor, limit }: NewsPageRequest): Promise<NewsArchivePage> {
    const now = this.now();
    const span = WINDOW_MS[window];
    const since = new Date(span === null ? 0 : now - span);
    const before = cursor === null ? null : decodeNewsCursor(cursor);

    const local: PersistedNewsItem[] = [];
    for (const row of this.cache) {
      if (row.publishedAt < since) break;
      if (before && !isBefore(row, before)) continue;
      local.push(row);
      if (local.length === limit) break;
    }

    const coverageStart = now - this.options.localRetentionMs;
    const needsDelegate =
      this.delegate.enabled && local.length < limit && since.getTime() < coverageStart;

    let rows = local;
    if (needsDelegate) {
      // Storage rows newer than the oldest cached row are already in the cache, so storage is
      // only asked for what lies below it. That keeps the delegate cursor fixed while new
      // headlines shift page boundaries, so the memo holds until the next flush.
      const floor = this.cache.at(-1) ?? null;
      const delegateBefore = floor && (!before || !isBefore(before, floor)) ? floor : before;
      const remote = await this.loadDelegatePage(window, since, delegateBefore, limit);
      const byId = new Map<string, PersistedNewsItem>();
      for (const row of remote) byId.set(row.id, row);
      for (const row of local) byId.set(row.id, row);
      rows = [...byId.values()].sort(compareDesc).slice(0, limit);
    }

    const last = rows.at(-1);
    return {
      items: rows.map(toNewsItem),
      nextCursor: rows.length === limit && last ? encodeNewsCursor(last) : null,
    };
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const localCutoff = new Date(this.now() - this.options.localRetentionMs);
      const kept = this.cache.filter((row) => row.publishedAt >= localCutoff);
      if (kept.length !== this.cache.length) {
        for (const row of this.cache) if (row.publishedAt < localCutoff) this.ids.delete(row.id);
        this.cache = kept;
        rewriteJsonLines(this.options.cachePath, this.cache, encodeNewsItem);
      }
      if (!this.delegate.enabled) return;

      const batch = [...this.pending];
      if (batch.length > 0) {
        await this.delegate.writeMany(batch);
        const flushed = new Set(batch);
        this.pending = this.pending.filter((row) => !flushed.has(row));
        rewriteOutbox(this.pendingPath, this.pending, encodeNewsItem);
      }
      await this.delegate.prune(new Date(this.now() - this.options.retentionMs));
      this.dbPages.clear();
    } finally {
      this.flushing = false;
    }
  }

  async dispose(): Promise<void> {
    this.timer.dispose();
    if (this.options.flushOnDispose === true) await this.flush();
    await this.delegate.dispose();
  }

  private async loadDelegatePage(
    window: NewsWindow,
    since: Date,
    before: NewsCursor | null,
    limit: number,
  ): Promise<PersistedNewsItem[]> {
    const key = `${window}|${before ? `${before.publishedAt.getTime()}:${before.id}` : ''}|${limit}`;
    const memo = this.dbPages.get(key);
    if (memo) return memo.filter((row) => row.publishedAt >= since);
    try {
      const rows = await this.delegate.loadPage({ since, before, limit });
      if (this.dbPages.size >= DB_PAGE_MEMO_MAX) this.dbPages.clear();
      this.dbPages.set(key, rows);
      return rows;
    } catch (err: unknown) {
      this.log.warn({ err: describeError(err) }, 'news archive page from storage failed');
      return [];
    }
  }
}
