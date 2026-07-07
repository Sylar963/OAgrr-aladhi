import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DealerBookStore,
  OiSnapshotStore,
  PersistedDealerPosition,
  PersistedOiSnapshot,
} from '@oggregator/db';
import { afterEach, describe, expect, it } from 'vitest';
import { DeferredDealerBookStore, DeferredOiSnapshotStore } from './deferred-persistence.js';

const noopLog = { warn: () => {} };
const flushIntervalMs = 60 * 60 * 1000;
let dirs: string[] = [];

function tempPath(file: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogg-deferred-'));
  dirs.push(dir);
  return join(dir, file);
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

const oiRow: PersistedOiSnapshot = {
  venue: 'deribit',
  underlying: 'BTC',
  instrumentName: 'BTC-30JUN26-70000-C',
  expiry: '2026-06-30',
  strike: 70000,
  optionType: 'call',
  openInterest: 100,
  snapshotTs: new Date(1_000),
};

const dealerRow: PersistedDealerPosition = {
  venue: 'deribit',
  underlying: 'BTC',
  instrumentName: 'BTC-30JUN26-70000-C',
  expiry: '2026-06-30',
  strike: 70000,
  optionType: 'call',
  dealerContracts: 100,
  lastOi: 100,
  lastSnapshotTs: new Date(1_000),
};

class FakeOiStore implements OiSnapshotStore {
  readonly enabled = true;
  readonly writes: PersistedOiSnapshot[][] = [];
  readonly prunes: Date[] = [];
  disposed = false;

  async writeMany(rows: PersistedOiSnapshot[]): Promise<void> {
    this.writes.push(rows);
  }

  async prune(before: Date): Promise<number> {
    this.prunes.push(before);
    return 0;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

class FakeDealerBookStore implements DealerBookStore {
  readonly enabled = true;
  readonly upserts: PersistedDealerPosition[][] = [];
  readonly prunes: string[] = [];
  disposed = false;

  constructor(private readonly loaded: PersistedDealerPosition[] = []) {}

  async loadAll(_underlyings: string[]): Promise<PersistedDealerPosition[]> {
    return this.loaded;
  }

  async upsertMany(positions: PersistedDealerPosition[]): Promise<void> {
    this.upserts.push(positions);
  }

  async pruneExpired(beforeExpiry: string): Promise<number> {
    this.prunes.push(beforeExpiry);
    return 0;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

describe('DeferredOiSnapshotStore', () => {
  it('caches snapshots locally until an explicit flush', async () => {
    const cachePath = tempPath('oi.ndjson');
    const delegate = new FakeOiStore();
    const store = new DeferredOiSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await store.writeMany([oiRow]);
    await store.prune(new Date(500));

    expect(delegate.writes).toEqual([]);
    expect(existsSync(cachePath)).toBe(true);

    await store.flush();

    expect(delegate.writes).toHaveLength(1);
    expect(delegate.writes[0]).toEqual([oiRow]);
    expect(delegate.prunes).toEqual([new Date(500)]);
    expect(existsSync(cachePath)).toBe(false);
    await store.dispose();
  });

  it('bootstraps pending snapshots from the local cache after restart', async () => {
    const cachePath = tempPath('oi-restart.ndjson');
    const first = new DeferredOiSnapshotStore(
      new FakeOiStore(),
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await first.writeMany([oiRow]);

    const delegate = new FakeOiStore();
    const restarted = new DeferredOiSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await restarted.flush();

    expect(delegate.writes).toHaveLength(1);
    expect(delegate.writes[0]).toEqual([oiRow]);
    expect(existsSync(cachePath)).toBe(false);
    await restarted.dispose();
  });
});

describe('DeferredDealerBookStore', () => {
  it('overlays local cached positions when bootstrapping the book', async () => {
    const cachePath = tempPath('dealer.ndjson');
    const first = new DeferredDealerBookStore(
      new FakeDealerBookStore(),
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await first.upsertMany([{ ...dealerRow, dealerContracts: 125, lastOi: 125 }]);

    const delegate = new FakeDealerBookStore([dealerRow]);
    const restarted = new DeferredDealerBookStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    const rows = await restarted.loadAll(['BTC']);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.dealerContracts).toBe(125);
    await restarted.dispose();
  });
});
