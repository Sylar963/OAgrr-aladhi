import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DealerBookStore,
  IvHistoryLoadQuery,
  IvHistoryStorageStats,
  IvHistoryStore,
  OiSnapshotStore,
  PersistedDealerPosition,
  PersistedIvHistoryPoint,
  PersistedOiSnapshot,
  PersistedRegimeModel,
  PersistedRegimeObservation,
  RegimeObservationLoadQuery,
  RegimeStore,
} from '@oggregator/db';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DeferredDealerBookStore,
  DeferredIvHistoryStore,
  DeferredOiSnapshotStore,
  DeferredRegimeStore,
} from './deferred-persistence.js';

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

const ivPoint: PersistedIvHistoryPoint = {
  underlying: 'BTC',
  tenorDays: 30,
  ts: new Date(1_000),
  atmIv: 0.52,
  rr25d: 0.01,
  bfly25d: 0.02,
  rr10d: null,
  bfly10d: null,
  source: 'live_surface',
};

const regimeObservation: PersistedRegimeObservation = {
  underlying: 'BTC',
  ts: new Date(1_000),
  features: [0.5, 0.01, 0.02, 0.001],
  posterior: [0.8, 0.1, 0.1],
  dominant: 'low-vol',
};

const regimeModel: PersistedRegimeModel = {
  underlying: 'BTC',
  fittedAt: new Date(2_000),
  observationCount: 1,
  nStates: 3,
  hmm: { nStates: 3 },
  standardization: { means: [0], stds: [1] },
  stateLabels: ['low-vol', 'mid-vol', 'high-vol'],
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
  loadCalls = 0;
  disposed = false;

  constructor(private readonly loaded: PersistedDealerPosition[] = []) {}

  async loadAll(_underlyings: string[]): Promise<PersistedDealerPosition[]> {
    this.loadCalls += 1;
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

class FakeIvHistoryStore implements IvHistoryStore {
  readonly enabled = true;
  readonly writes: PersistedIvHistoryPoint[][] = [];
  storageStatsCalls = 0;
  disposed = false;

  constructor(private readonly loaded: PersistedIvHistoryPoint[] = []) {}

  async writeMany(points: PersistedIvHistoryPoint[]): Promise<void> {
    this.writes.push(points);
  }

  async loadSince(_query: IvHistoryLoadQuery): Promise<PersistedIvHistoryPoint[]> {
    return this.loaded;
  }

  async getStorageStats(): Promise<IvHistoryStorageStats> {
    this.storageStatsCalls += 1;
    return { enabled: true, bytes: 100, thresholdBytes: 1_000, warning: false };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

class FakeRegimeStore implements RegimeStore {
  readonly enabled = true;
  readonly models: PersistedRegimeModel[] = [];
  readonly observations: PersistedRegimeObservation[] = [];
  disposed = false;

  constructor(
    private readonly loadedModels: PersistedRegimeModel[] = [],
    private readonly loadedObservations: PersistedRegimeObservation[] = [],
  ) {}

  async loadModel(underlying: string): Promise<PersistedRegimeModel | null> {
    return this.loadedModels.find((model) => model.underlying === underlying) ?? null;
  }

  async saveModel(model: PersistedRegimeModel): Promise<void> {
    this.models.push(model);
  }

  async loadObservationsSince(
    _query: RegimeObservationLoadQuery,
  ): Promise<PersistedRegimeObservation[]> {
    return this.loadedObservations;
  }

  async saveObservation(row: PersistedRegimeObservation): Promise<void> {
    this.observations.push(row);
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

  it('bootstraps a rewritten cache across read and write chunk boundaries', async () => {
    const cachePath = tempPath('oi-chunked-restart.ndjson');
    const snapshots = Array.from({ length: 6 }, (_, index) => ({
      ...oiRow,
      instrumentName: `BTC-${index}-${'X'.repeat(256 * 1024)}`,
      snapshotTs: new Date(1_000 + index),
    }));
    const first = new DeferredOiSnapshotStore(
      new FakeOiStore(),
      { cachePath, flushIntervalMs, maxPendingRows: 5 },
      noopLog,
    );

    await first.writeMany(snapshots);
    await first.dispose();

    const delegate = new FakeOiStore();
    const restarted = new DeferredOiSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 5 },
      noopLog,
    );
    await restarted.flush();

    expect(delegate.writes).toEqual([snapshots.slice(1)]);
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
    expect(delegate.loadCalls).toBe(0);

    await restarted.flush();

    expect(delegate.upserts).toHaveLength(1);
    expect(existsSync(cachePath)).toBe(true);
    await restarted.flush();
    expect(delegate.upserts).toHaveLength(1);
    await restarted.dispose();
  });
});

describe('DeferredIvHistoryStore', () => {
  it('caches IV points locally and serves them without touching storage stats in Postgres', async () => {
    const cachePath = tempPath('iv.ndjson');
    const delegate = new FakeIvHistoryStore();
    const store = new DeferredIvHistoryStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100, thresholdBytes: 1_000_000 },
      noopLog,
    );

    await store.writeMany([ivPoint]);
    const rows = await store.loadSince({ underlyings: ['BTC'], since: new Date(0) });
    const stats = await store.getStorageStats();

    expect(delegate.writes).toEqual([]);
    expect(rows).toEqual([ivPoint]);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(delegate.storageStatsCalls).toBe(0);

    await store.flush();

    expect(delegate.writes).toEqual([[ivPoint]]);
    expect(existsSync(cachePath)).toBe(true);

    await store.flush();

    expect(delegate.writes).toEqual([[ivPoint]]);
    await store.dispose();
  });
});

describe('DeferredRegimeStore', () => {
  it('caches regime observations and latest models until flush', async () => {
    const observationsCachePath = tempPath('regime-observations.ndjson');
    const modelsCachePath = tempPath('regime-models.ndjson');
    const delegate = new FakeRegimeStore();
    const store = new DeferredRegimeStore(
      delegate,
      { observationsCachePath, modelsCachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await store.saveObservation(regimeObservation);
    await store.saveModel(regimeModel);

    await expect(
      store.loadObservationsSince({ underlyings: ['BTC'], since: new Date(0) }),
    ).resolves.toEqual([regimeObservation]);
    await expect(store.loadModel('BTC')).resolves.toEqual(regimeModel);
    expect(delegate.observations).toEqual([]);
    expect(delegate.models).toEqual([]);

    await store.flush();

    expect(delegate.observations).toEqual([regimeObservation]);
    expect(delegate.models).toEqual([regimeModel]);
    expect(existsSync(observationsCachePath)).toBe(true);
    expect(existsSync(modelsCachePath)).toBe(true);

    await store.flush();

    expect(delegate.observations).toEqual([regimeObservation]);
    expect(delegate.models).toEqual([regimeModel]);
    await store.dispose();
  });
});
