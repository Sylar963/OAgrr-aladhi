import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeferredTradeStore } from './deferred-trade-store.js';
import { SqliteTradeStore } from './sqlite-trade-store.js';
import type {
  InstrumentListQuery,
  InstrumentSummary,
  RecentTradeQuery,
  TradeFilterQuery,
  TradeHistoryQuery,
  TradeHistorySummary,
  TradePruneResult,
  TradeRecordKey,
  TradeStore,
} from './trade-store.js';
import type { PersistedTradeRecord } from './types.js';

const noopLog = { warn: () => {} };
const flushIntervalMs = 60 * 60 * 1000;
let dirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('DeferredTradeStore', () => {
  it('makes pending trades queryable before a remote upload', async () => {
    const store = createStore(new FakeTradeStore());
    await store.writeMany([trade({ tradeUid: 'pending' })]);

    const rows = await store.loadHistory({ mode: 'live', limit: 10 });

    expect(rows.map((row) => row.tradeUid)).toEqual(['pending']);
    await store.dispose();
  });

  it('ignores duplicate local replay writes', async () => {
    const store = createStore(new FakeTradeStore());
    const row = trade({ tradeUid: 'duplicate' });

    await store.writeMany([row, row]);

    expect(await store.loadHistory({ mode: 'live', limit: 10 })).toHaveLength(1);
    await store.dispose();
  });

  it('retains a failed upload batch locally', async () => {
    const delegate = new FakeTradeStore();
    const store = createStore(delegate);
    await store.writeMany([trade({ tradeUid: 'failed' })]);
    delegate.failWrites = true;

    await expect(store.flush()).rejects.toThrow('write failed');

    expect(await store.loadHistory({ mode: 'live', limit: 10 })).toHaveLength(1);
    await store.dispose();
  });

  it('retains every local row when a later upload batch fails', async () => {
    const sqlitePath = tempPath('partial-failure.sqlite');
    const delegate = new FakeTradeStore();
    delegate.failAfterWrites = 1;
    const store = createStore(delegate, { sqlitePath, flushBatchSize: 2 });
    await store.writeMany(
      Array.from({ length: 5 }, (_, index) =>
        trade({ tradeUid: `partial-${index}`, tradeTs: new Date(index) }),
      ),
    );

    await expect(store.flush()).rejects.toThrow('write failed');
    const localReader = new SqliteTradeStore(sqlitePath, { readOnly: true });

    expect(await localReader.loadHistory({ mode: 'live', limit: 10 })).toHaveLength(5);
    await localReader.dispose();
    await store.dispose();
  });

  it('deduplicates a row when the remote commit succeeds before an upload error', async () => {
    const delegate = new FakeTradeStore();
    delegate.commitThenFail = true;
    const store = createStore(delegate);
    await store.writeMany([trade({ tradeUid: 'commit-window' })]);

    await expect(store.flush()).rejects.toThrow('write failed after commit');

    expect(await store.loadHistory({ mode: 'live', limit: 10 })).toHaveLength(1);
    await store.dispose();
  });

  it('deletes local rows only after successful bounded uploads', async () => {
    const sqlitePath = tempPath('successful.sqlite');
    const delegate = new FakeTradeStore();
    const store = createStore(delegate, { sqlitePath, flushBatchSize: 2 });
    await store.writeMany(
      Array.from({ length: 5 }, (_, index) => trade({ tradeUid: `batch-${index}` })),
    );

    await store.flush();
    const localReader = new SqliteTradeStore(sqlitePath, { readOnly: true });

    expect(delegate.writes.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(await localReader.loadHistory({ mode: 'live', limit: 10 })).toHaveLength(0);
    expect(delegate.rows).toHaveLength(5);
    await localReader.dispose();
    await store.dispose();
  });

  it('persists retry backoff across restart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sqlitePath = tempPath('retry.sqlite');
    const failedDelegate = new FakeTradeStore();
    const first = createStore(failedDelegate, { sqlitePath, flushIntervalMs: 1_000 });
    failedDelegate.failWrites = true;
    await first.writeMany([trade({ tradeUid: 'retry' })]);
    await expect(first.flush()).rejects.toThrow('write failed');
    await first.dispose();

    const restartedDelegate = new FakeTradeStore();
    const writeMany = vi.spyOn(restartedDelegate, 'writeMany');
    const restarted = createStore(restartedDelegate, { sqlitePath, flushIntervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(writeMany).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(writeMany).toHaveBeenCalledOnce();
    await restarted.dispose();
  });

  it('does not let new writes override a failed flush deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const delegate = new FakeTradeStore();
    const writeMany = vi.spyOn(delegate, 'writeMany');
    const store = createStore(delegate, { flushIntervalMs: 1_000 });
    delegate.failWrites = true;
    await store.writeMany([trade({ tradeUid: 'first' })]);
    await expect(store.flush()).rejects.toThrow('write failed');

    vi.setSystemTime(100);
    await store.writeMany([trade({ tradeUid: 'second' })]);
    await vi.advanceTimersByTimeAsync(899);
    expect(writeMany).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(writeMany).toHaveBeenCalledTimes(2);
    await store.dispose();
  });

  it('imports active and interrupted legacy spools before scheduling uploads', async () => {
    const dir = tempDir();
    const legacyPath = join(dir, 'ingest-trades.ndjson');
    const flushingPath = `${legacyPath}.flushing`;
    writeFileSync(legacyPath, `${JSON.stringify(legacyRow(trade({ tradeUid: 'active' }), 100))}\n`);
    writeFileSync(
      flushingPath,
      `${JSON.stringify(legacyRow(trade({ tradeUid: 'flushing' }), 50))}\n`,
    );

    const store = createStore(new FakeTradeStore(), {
      sqlitePath: join(dir, 'trades.sqlite'),
      legacyCachePaths: [legacyPath, flushingPath],
    });

    expect(
      (await store.loadHistory({ mode: 'live', limit: 10 })).map((row) => row.tradeUid),
    ).toEqual(['flushing', 'active']);
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(flushingPath)).toBe(false);
    expect(existsSync(`${legacyPath}.migrated`)).toBe(true);
    expect(existsSync(`${flushingPath}.migrated`)).toBe(true);
    await store.dispose();
  });

  it('reimports a legacy source safely after an interrupted migration', async () => {
    const dir = tempDir();
    const legacyPath = join(dir, 'ingest-trades.ndjson');
    const sqlitePath = join(dir, 'trades.sqlite');
    const rows = Array.from({ length: 1_001 }, (_, index) =>
      JSON.stringify(legacyRow(trade({ tradeUid: `legacy-${index}` }), index)),
    );
    writeFileSync(legacyPath, `${rows.slice(0, 1_000).join('\n')}\n{invalid-json}\n`);

    expect(() =>
      createStore(new FakeTradeStore(), { sqlitePath, legacyCachePaths: [legacyPath] }),
    ).toThrow();
    writeFileSync(legacyPath, `${rows.join('\n')}\n`);

    const restarted = createStore(new FakeTradeStore(), {
      sqlitePath,
      legacyCachePaths: [legacyPath],
    });
    expect(await restarted.loadHistory({ mode: 'live', limit: 2_000 })).toHaveLength(1_001);
    await restarted.dispose();
  });
});

interface StoreOverrides {
  sqlitePath?: string;
  legacyCachePaths?: string[];
  flushIntervalMs?: number;
  flushBatchSize?: number;
}

function createStore(delegate: FakeTradeStore, overrides: StoreOverrides = {}): DeferredTradeStore {
  return new DeferredTradeStore(
    delegate,
    {
      sqlitePath: overrides.sqlitePath ?? tempPath('trades.sqlite'),
      legacyCachePaths: overrides.legacyCachePaths ?? [],
      flushIntervalMs: overrides.flushIntervalMs ?? flushIntervalMs,
      flushBatchSize: overrides.flushBatchSize ?? 10_000,
      maxPendingRows: 100,
    },
    noopLog,
  );
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogg-trades-'));
  dirs.push(dir);
  return dir;
}

function tempPath(file: string): string {
  return join(tempDir(), file);
}

function trade(overrides: Partial<PersistedTradeRecord> = {}): PersistedTradeRecord {
  return {
    tradeUid: 'deribit:1',
    mode: 'live',
    venue: 'deribit',
    underlying: 'BTC',
    instrumentName: 'BTC-30JUN26-70000-C',
    tradeTs: new Date(1_000),
    ingestedAt: new Date(1_500),
    direction: 'buy',
    contracts: 1,
    price: 0.01,
    premiumUsd: 700,
    notionalUsd: 70_000,
    referencePriceUsd: 70_000,
    expiry: '2026-06-30',
    strike: 70_000,
    optionType: 'call',
    iv: 0.5,
    markPrice: 0.01,
    isBlock: false,
    strategyLabel: null,
    legs: null,
    raw: { tradeId: '1' },
    ...overrides,
  };
}

function legacyRow(record: PersistedTradeRecord, queuedAt: number): Record<string, unknown> {
  return {
    ...record,
    tradeTs: record.tradeTs.toISOString(),
    ingestedAt: record.ingestedAt.toISOString(),
    _queuedAt: queuedAt,
  };
}

class FakeTradeStore implements TradeStore {
  readonly enabled = true;
  readonly rows: PersistedTradeRecord[] = [];
  readonly writes: PersistedTradeRecord[][] = [];
  readonly ensured: number[] = [];
  failWrites = false;
  failAfterWrites: number | null = null;
  commitThenFail = false;

  async writeMany(records: PersistedTradeRecord[]): Promise<void> {
    if (this.failWrites) throw new Error('write failed');
    if (this.failAfterWrites != null && this.writes.length >= this.failAfterWrites) {
      throw new Error('write failed');
    }
    this.writes.push(records);
    const keys = new Set(this.rows.map(recordKey));
    for (const record of records) {
      if (!keys.has(recordKey(record))) this.rows.push(record);
    }
    if (this.commitThenFail) {
      this.commitThenFail = false;
      throw new Error('write failed after commit');
    }
  }

  async withReadSnapshot<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  async loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    return filterRows(this.rows, query).sort(compareRows).slice(0, query.limit);
  }

  async loadHistory(query: TradeHistoryQuery): Promise<PersistedTradeRecord[]> {
    return filterRows(this.rows, query)
      .filter(
        (row) =>
          query.beforeTs == null ||
          row.tradeTs < query.beforeTs ||
          (row.tradeTs.getTime() === query.beforeTs.getTime() &&
            query.beforeUid != null &&
            row.tradeUid < query.beforeUid),
      )
      .sort(compareRows)
      .slice(0, query.limit);
  }

  async loadByKeys(
    query: TradeFilterQuery,
    keys: TradeRecordKey[],
  ): Promise<PersistedTradeRecord[]> {
    const wanted = new Set(keys.map(recordKey));
    return filterRows(this.rows, query).filter((row) => wanted.has(recordKey(row)));
  }

  async summarizeHistory(
    query: TradeFilterQuery & { mode: PersistedTradeRecord['mode'] },
  ): Promise<TradeHistorySummary> {
    const rows = filterRows(this.rows, query);
    const timestamps = rows.map((row) => row.tradeTs.getTime());
    return {
      count: rows.length,
      premiumUsd: rows.reduce((sum, row) => sum + (row.premiumUsd ?? 0), 0),
      notionalUsd: rows.reduce((sum, row) => sum + (row.notionalUsd ?? 0), 0),
      oldestTs: timestamps.length === 0 ? null : new Date(Math.min(...timestamps)),
      newestTs: timestamps.length === 0 ? null : new Date(Math.max(...timestamps)),
      venues: [],
    };
  }

  async listInstruments(query: InstrumentListQuery): Promise<InstrumentSummary[]> {
    return instrumentSummaries(filterRows(this.rows, query)).slice(0, query.limit);
  }

  async listInstrumentsByNames(
    query: TradeFilterQuery & { mode: PersistedTradeRecord['mode'] },
    instrumentNames: string[],
  ): Promise<InstrumentSummary[]> {
    const names = new Set(instrumentNames);
    return instrumentSummaries(
      filterRows(this.rows, query).filter((row) => names.has(row.instrumentName)),
    );
  }

  async pruneHistory(_beforeTs: Date): Promise<TradePruneResult> {
    return { deleted: 0 };
  }

  async ensureForwardPartitions(monthsAhead: number): Promise<void> {
    this.ensured.push(monthsAhead);
  }

  async dispose(): Promise<void> {}
}

function filterRows(rows: PersistedTradeRecord[], query: TradeFilterQuery): PersistedTradeRecord[] {
  return rows.filter(
    (row) =>
      (query.mode == null || row.mode === query.mode) &&
      (query.underlying == null || row.underlying === query.underlying.toUpperCase()) &&
      (query.venues == null || query.venues.length === 0 || query.venues.includes(row.venue)) &&
      (query.instrumentName == null || row.instrumentName === query.instrumentName) &&
      (query.startTs == null || row.tradeTs >= query.startTs) &&
      (query.endTs == null || row.tradeTs < query.endTs),
  );
}

function instrumentSummaries(rows: PersistedTradeRecord[]): InstrumentSummary[] {
  const grouped = new Map<string, PersistedTradeRecord[]>();
  for (const row of rows)
    grouped.set(row.instrumentName, [...(grouped.get(row.instrumentName) ?? []), row]);
  return [...grouped.entries()]
    .map(([instrument, records]) => {
      const latest = records.sort(compareRows)[0];
      if (latest == null) throw new Error('missing latest record');
      return {
        instrument,
        count: records.length,
        lastTs: latest.tradeTs,
        lastPrice: latest.price,
        lastReferencePriceUsd: latest.referencePriceUsd,
        optionType: latest.optionType,
        strike: latest.strike,
        expiry: latest.expiry,
      };
    })
    .sort(
      (left, right) => right.count - left.count || right.lastTs.getTime() - left.lastTs.getTime(),
    );
}

function compareRows(left: PersistedTradeRecord, right: PersistedTradeRecord): number {
  return (
    right.tradeTs.getTime() - left.tradeTs.getTime() || right.tradeUid.localeCompare(left.tradeUid)
  );
}

function recordKey(record: TradeRecordKey): string {
  return `${record.tradeUid}:${record.tradeTs.getTime()}`;
}
