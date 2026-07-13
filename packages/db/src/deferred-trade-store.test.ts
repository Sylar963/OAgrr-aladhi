import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeferredTradeStore } from './deferred-trade-store.js';
import type {
  InstrumentListQuery,
  InstrumentSummary,
  RecentTradeQuery,
  TradeFilterQuery,
  TradeHistoryQuery,
  TradeHistorySummary,
  TradePruneResult,
  TradeStore,
} from './trade-store.js';
import type { PersistedTradeRecord } from './types.js';

const noopLog = { warn: () => {} };
const flushIntervalMs = 60 * 60 * 1000;
let dirs: string[] = [];

function tempPath(file: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogg-trades-'));
  dirs.push(dir);
  return join(dir, file);
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

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
    strike: 70000,
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

class FakeTradeStore implements TradeStore {
  readonly enabled = true;
  readonly writes: PersistedTradeRecord[][] = [];
  readonly ensured: number[] = [];
  readonly prunes: Date[] = [];
  failWrites = false;
  disposed = false;

  async writeMany(records: PersistedTradeRecord[]): Promise<void> {
    if (this.failWrites) throw new Error('write failed');
    this.writes.push(records);
  }

  async loadRecent(_query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    return [];
  }

  async loadHistory(_query: TradeHistoryQuery): Promise<PersistedTradeRecord[]> {
    return [];
  }

  async summarizeHistory(
    _query: TradeFilterQuery & { mode: PersistedTradeRecord['mode'] },
  ): Promise<TradeHistorySummary> {
    return { count: 0, premiumUsd: 0, notionalUsd: 0, oldestTs: null, newestTs: null, venues: [] };
  }

  async listInstruments(_query: InstrumentListQuery): Promise<InstrumentSummary[]> {
    return [];
  }

  async pruneHistory(beforeTs: Date): Promise<TradePruneResult> {
    this.prunes.push(beforeTs);
    return { deleted: 0 };
  }

  async ensureForwardPartitions(monthsAhead: number): Promise<void> {
    this.ensured.push(monthsAhead);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

describe('DeferredTradeStore', () => {
  it('caches trades locally until an explicit flush', async () => {
    const cachePath = tempPath('trades.ndjson');
    const delegate = new FakeTradeStore();
    const store = new DeferredTradeStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await store.writeMany([trade()]);

    expect(delegate.writes).toEqual([]);
    expect(existsSync(cachePath)).toBe(true);

    await store.flush();

    expect(delegate.writes).toHaveLength(1);
    expect(delegate.writes[0]).toEqual([trade()]);
    expect(existsSync(cachePath)).toBe(false);
    await store.dispose();
  });

  it('replays locally cached trades after restart', async () => {
    const cachePath = tempPath('restart.ndjson');
    const first = new DeferredTradeStore(
      new FakeTradeStore(),
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await first.writeMany([trade({ tradeUid: 'deribit:restart' })]);

    const delegate = new FakeTradeStore();
    const restarted = new DeferredTradeStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await restarted.flush();

    expect(delegate.writes).toHaveLength(1);
    expect(delegate.writes[0]?.[0]?.tradeUid).toBe('deribit:restart');
    expect(existsSync(cachePath)).toBe(false);
    await restarted.dispose();
  });

  it('defers partition maintenance and pruning until flush', async () => {
    const cachePath = tempPath('maintenance.ndjson');
    const delegate = new FakeTradeStore();
    const store = new DeferredTradeStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await store.ensureForwardPartitions(3);
    await store.pruneHistory(new Date(2_000));

    expect(delegate.ensured).toEqual([]);
    expect(delegate.prunes).toEqual([]);

    await store.flush();

    expect(delegate.ensured).toEqual([3]);
    expect(delegate.prunes).toEqual([new Date(2_000)]);
    await store.dispose();
  });

  it('keeps the local cache when a database flush fails', async () => {
    const cachePath = tempPath('failed.ndjson');
    const delegate = new FakeTradeStore();
    const store = new DeferredTradeStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await store.writeMany([trade({ tradeUid: 'deribit:failed' })]);

    delegate.failWrites = true;
    await expect(store.flush()).rejects.toThrow('write failed');

    expect(existsSync(cachePath)).toBe(true);

    delegate.failWrites = false;
    await store.flush();

    expect(delegate.writes[0]?.[0]?.tradeUid).toBe('deribit:failed');
    expect(existsSync(cachePath)).toBe(false);
    await store.dispose();
  });

  it('retains every row after the spool warning threshold is exceeded', async () => {
    const cachePath = tempPath('threshold.ndjson');
    const delegate = new FakeTradeStore();
    const warn = vi.fn();
    const store = new DeferredTradeStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 2 },
      { warn },
    );
    const rows = [
      trade({ tradeUid: 'deribit:threshold-1' }),
      trade({ tradeUid: 'deribit:threshold-2' }),
      trade({ tradeUid: 'deribit:threshold-3' }),
    ];

    await store.writeMany(rows);
    await store.flush();

    expect(delegate.writes.flat()).toEqual(rows);
    expect(warn).toHaveBeenCalledOnce();
    await store.dispose();
  });

  it('preserves the oldest row flush deadline across restart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cachePath = tempPath('deadline.ndjson');
    const intervalMs = 1_000;
    const first = new DeferredTradeStore(
      new FakeTradeStore(),
      { cachePath, flushIntervalMs: intervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await first.writeMany([trade({ tradeUid: 'deribit:deadline' })]);
    await first.dispose();

    vi.setSystemTime(900);
    const delegate = new FakeTradeStore();
    const restarted = new DeferredTradeStore(
      delegate,
      { cachePath, flushIntervalMs: intervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await vi.advanceTimersByTimeAsync(99);
    expect(delegate.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(delegate.writes.flat().map((row) => row.tradeUid)).toEqual(['deribit:deadline']);
    await restarted.dispose();
  });
});
