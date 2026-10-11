import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewsPageQuery, NewsStore, PersistedNewsItem } from '@oggregator/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsArchive, type NewsArchiveOptions, toPersistedNewsItem } from './news-archive.js';
import type { NewsItem } from './news-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 11);
const silentLog = { warn: vi.fn() };

function newsItem(id: string, ageMs: number): NewsItem {
  const timestamp = NOW - ageMs;
  return {
    id,
    text: `headline ${id}`,
    url: `https://twitter.com/x/status/${id}`,
    source: 'Twitter[brain-fastlane] - @FirstSquawk',
    handle: 'FirstSquawk',
    ruleTag: 'brain-fastlane',
    timestamp,
    classification: 'GOOD',
    createdAt: new Date(timestamp + 1000).toISOString(),
  };
}

function fakeStore(rows: PersistedNewsItem[] = []) {
  const written: PersistedNewsItem[] = [];
  const loadPage = vi.fn(async ({ since, before, limit }: NewsPageQuery) =>
    rows
      .filter((row) => row.publishedAt >= since)
      .filter(
        (row) =>
          !before ||
          row.publishedAt < before.publishedAt ||
          (row.publishedAt.getTime() === before.publishedAt.getTime() && row.id < before.id),
      )
      .slice(0, limit),
  );
  const store: NewsStore = {
    enabled: true,
    writeMany: vi.fn(async (batch: PersistedNewsItem[]) => {
      written.push(...batch);
    }),
    loadPage,
    prune: vi.fn(async () => 0),
    dispose: vi.fn(async () => {}),
  };
  return { store, written, loadPage };
}

describe('NewsArchive', () => {
  let dir: string;
  let archives: NewsArchive[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'news-archive-'));
    archives = [];
  });

  afterEach(async () => {
    for (const archive of archives) await archive.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  function open(store: NewsStore, overrides: Partial<NewsArchiveOptions> = {}): NewsArchive {
    const archive = new NewsArchive(
      store,
      {
        cachePath: join(dir, 'news.ndjson'),
        flushIntervalMs: DAY_MS,
        localRetentionMs: 30 * DAY_MS,
        retentionMs: 400 * DAY_MS,
        maxPendingRows: 1000,
        now: () => NOW,
        ...overrides,
      },
      silentLog,
    );
    archives.push(archive);
    return archive;
  }

  it('dedupes by id and survives a restart', () => {
    const { store } = fakeStore();
    const first = open(store);
    first.record([newsItem('a', 2000), newsItem('b', 1000)]);
    first.record([newsItem('b', 1000), newsItem('c', 3000)]);
    expect(first.size).toBe(3);

    const reopened = open(store);
    expect(reopened.recent(10).map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(reopened.pendingCount).toBe(3);
  });

  it('pages a window newest-first with a keyset cursor', async () => {
    const { store, loadPage } = fakeStore();
    const archive = open(store);
    archive.record([
      newsItem('a', 1 * 60_000),
      newsItem('b', 2 * 60_000),
      newsItem('c', 3 * 60_000),
      newsItem('old', 2 * DAY_MS),
    ]);

    const first = await archive.page({ window: '24h', cursor: null, limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(first.nextCursor).not.toBeNull();

    const second = await archive.page({ window: '24h', cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((i) => i.id)).toEqual(['c']);
    expect(second.nextCursor).toBeNull();
    expect(loadPage).not.toHaveBeenCalled();
  });

  it('reads storage only past local coverage and memoizes until the next flush', async () => {
    const archived = toPersistedNewsItem(newsItem('archived', 90 * DAY_MS));
    const { store, loadPage } = fakeStore([archived]);
    const archive = open(store);
    archive.record([newsItem('fresh', 60_000)]);

    const full = await archive.page({ window: '30d', cursor: null, limit: 1 });
    expect(full.items.map((i) => i.id)).toEqual(['fresh']);
    expect(loadPage).not.toHaveBeenCalled();

    const year = await archive.page({ window: '1y', cursor: null, limit: 10 });
    expect(year.items.map((i) => i.id)).toEqual(['fresh', 'archived']);
    await archive.page({ window: '1y', cursor: null, limit: 10 });
    expect(loadPage).toHaveBeenCalledTimes(1);

    await archive.flush();
    await archive.page({ window: '1y', cursor: null, limit: 10 });
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it('flushes pending rows once and prunes the local cache to its retention', async () => {
    const { store, written } = fakeStore();
    const archive = open(store);
    archive.record([newsItem('keep', DAY_MS), newsItem('stale', 45 * DAY_MS)]);

    await archive.flush();
    expect(written.map((r) => r.id).sort()).toEqual(['keep', 'stale']);
    expect(archive.pendingCount).toBe(0);
    expect(archive.recent(10).map((i) => i.id)).toEqual(['keep']);
    expect(readFileSync(join(dir, 'news.ndjson'), 'utf8')).not.toContain('stale');

    const reopened = open(store);
    expect(reopened.pendingCount).toBe(0);
  });
});
