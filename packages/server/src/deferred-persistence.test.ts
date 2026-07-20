import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  PersistedShortStraddleSnapshot,
  RegimeObservationLoadQuery,
  RegimeStore,
  ShortStraddleSnapshotStore,
} from '@oggregator/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeferredDealerBookStore,
  DeferredIvHistoryStore,
  DeferredOiSnapshotStore,
  DeferredRegimeStore,
  DeferredShortStraddleSnapshotStore,
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

const shortStraddleSnapshot: PersistedShortStraddleSnapshot = {
  venue: 'deribit',
  underlying: 'BTC',
  sampleSlotTs: new Date('2026-07-13T10:00:00.000Z'),
  capturedAt: new Date('2026-07-13T10:05:00.000Z'),
  expiry: '2026-07-20',
  expiryTs: new Date('2026-07-20T08:00:00.000Z'),
  strike: 60_000,
  spotPriceUsd: 60_100,
  forwardPriceUsd: 60_200,
  callBidUsd: 1_000,
  callAskUsd: 1_020,
  callBidSize: 2,
  callAskSize: 3,
  callMarkIv: 0.5,
  callDelta: 0.51,
  callVegaUsdPerVolPoint: 120,
  callOpenInterest: 500,
  callMakerFeeUsd: 2,
  callTakerFeeUsd: 3,
  callQuoteTs: new Date('2026-07-13T10:04:55.000Z'),
  putBidUsd: 900,
  putAskUsd: 930,
  putBidSize: 4,
  putAskSize: 5,
  putMarkIv: 0.52,
  putDelta: -0.49,
  putVegaUsdPerVolPoint: 121,
  putOpenInterest: 600,
  putMakerFeeUsd: 2.1,
  putTakerFeeUsd: 3.1,
  putQuoteTs: new Date('2026-07-13T10:04:56.000Z'),
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

class FakeShortStraddleSnapshotStore implements ShortStraddleSnapshotStore {
  readonly enabled = true;
  readonly writes: PersistedShortStraddleSnapshot[][] = [];
  disposed = false;
  fail = false;
  block: Promise<void> | null = null;

  async writeMany(rows: PersistedShortStraddleSnapshot[]): Promise<void> {
    if (this.fail) throw new Error('database unavailable');
    if (this.block != null) await this.block;
    this.writes.push(rows);
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

  it('skips malformed cache lines and reports them', async () => {
    const cachePath = tempPath('iv-malformed.ndjson');
    writeFileSync(
      cachePath,
      `not-json\n${JSON.stringify({ ...ivPoint, ts: ivPoint.ts.toISOString() })}\n`,
    );
    const warn = vi.fn();
    const store = new DeferredIvHistoryStore(
      new FakeIvHistoryStore(),
      { cachePath, flushIntervalMs, maxPendingRows: 100, thresholdBytes: 1_000_000 },
      { warn },
    );

    await expect(store.loadSince({ underlyings: ['BTC'], since: new Date(0) })).resolves.toEqual([
      ivPoint,
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: cachePath }),
      'skipping malformed deferred cache line',
    );
    await store.dispose();
  });
});

describe('DeferredShortStraddleSnapshotStore', () => {
  it('rejects invalid records when decoding the local NDJSON boundary', () => {
    const cachePath = tempPath('short-straddle-invalid.ndjson');
    writeFileSync(cachePath, `${JSON.stringify({ ...shortStraddleSnapshot, capturedAt: null })}\n`);

    expect(
      () =>
        new DeferredShortStraddleSnapshotStore(
          new FakeShortStraddleSnapshotStore(),
          { cachePath, flushIntervalMs, maxPendingRows: 100 },
          noopLog,
        ),
    ).toThrow();
  });

  it('appends locally without calling the database', async () => {
    const cachePath = tempPath('short-straddle.ndjson');
    const delegate = new FakeShortStraddleSnapshotStore();
    const store = new DeferredShortStraddleSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await store.writeMany([shortStraddleSnapshot]);

    expect(delegate.writes).toEqual([]);
    expect(existsSync(cachePath)).toBe(true);
    await store.dispose();
  });

  it('recovers pending snapshots from NDJSON after restart', async () => {
    const cachePath = tempPath('short-straddle-restart.ndjson');
    const first = new DeferredShortStraddleSnapshotStore(
      new FakeShortStraddleSnapshotStore(),
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await first.writeMany([shortStraddleSnapshot]);
    await first.dispose();
    const delegate = new FakeShortStraddleSnapshotStore();
    const restarted = new DeferredShortStraddleSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );

    await restarted.flush();

    expect(delegate.writes).toEqual([[shortStraddleSnapshot]]);
    expect(existsSync(cachePath)).toBe(false);
    await restarted.dispose();
  });

  it('preserves every pending snapshot after a database failure', async () => {
    const cachePath = tempPath('short-straddle-failure.ndjson');
    const delegate = new FakeShortStraddleSnapshotStore();
    delegate.fail = true;
    const store = new DeferredShortStraddleSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await store.writeMany([shortStraddleSnapshot]);

    await expect(store.flush()).rejects.toThrow('database unavailable');
    delegate.fail = false;
    await store.flush();

    expect(delegate.writes).toEqual([[shortStraddleSnapshot]]);
    expect(existsSync(cachePath)).toBe(false);
    await store.dispose();
  });

  it('keeps writes that arrive during a flush pending', async () => {
    const cachePath = tempPath('short-straddle-concurrent.ndjson');
    const delegate = new FakeShortStraddleSnapshotStore();
    let release: (() => void) | undefined;
    delegate.block = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new DeferredShortStraddleSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await store.writeMany([shortStraddleSnapshot]);
    const flush = store.flush();
    const next = {
      ...shortStraddleSnapshot,
      sampleSlotTs: new Date('2026-07-13T11:00:00.000Z'),
      capturedAt: new Date('2026-07-13T11:05:00.000Z'),
    };

    await store.writeMany([next]);
    release?.();
    await flush;
    delegate.block = null;
    await store.flush();

    expect(delegate.writes).toEqual([[shortStraddleSnapshot], [next]]);
    await store.dispose();
  });

  it('does not force a database flush during shutdown', async () => {
    const cachePath = tempPath('short-straddle-shutdown.ndjson');
    const delegate = new FakeShortStraddleSnapshotStore();
    const store = new DeferredShortStraddleSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await store.writeMany([shortStraddleSnapshot]);

    await store.dispose();

    expect(delegate.writes).toEqual([]);
    expect(delegate.disposed).toBe(true);
    expect(existsSync(cachePath)).toBe(true);
  });

  it('awaits an active flush before disposing the database store', async () => {
    const cachePath = tempPath('short-straddle-active-shutdown.ndjson');
    const delegate = new FakeShortStraddleSnapshotStore();
    let release: (() => void) | undefined;
    delegate.block = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = new DeferredShortStraddleSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 100 },
      noopLog,
    );
    await store.writeMany([shortStraddleSnapshot]);
    void store.flush();

    const dispose = store.dispose();
    expect(delegate.disposed).toBe(false);
    release?.();
    await dispose;

    expect(delegate.writes).toEqual([[shortStraddleSnapshot]]);
    expect(delegate.disposed).toBe(true);
  });

  it('warns without truncating rows above the configured threshold', async () => {
    const cachePath = tempPath('short-straddle-threshold.ndjson');
    const delegate = new FakeShortStraddleSnapshotStore();
    const warnings: object[] = [];
    const store = new DeferredShortStraddleSnapshotStore(
      delegate,
      { cachePath, flushIntervalMs, maxPendingRows: 1 },
      { warn: (obj) => warnings.push(obj) },
    );
    const next = {
      ...shortStraddleSnapshot,
      sampleSlotTs: new Date('2026-07-13T11:00:00.000Z'),
    };

    await store.writeMany([shortStraddleSnapshot, next]);
    await store.flush();

    expect(warnings).toHaveLength(1);
    expect(delegate.writes).toEqual([[shortStraddleSnapshot, next]]);
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
