import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
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

interface DeferredPersistenceOptions {
  flushIntervalMs: number;
  cachePath: string;
  maxPendingRows: number;
  thresholdBytes?: number;
  flushOnDispose?: boolean;
}

interface DeferredRegimePersistenceOptions {
  flushIntervalMs: number;
  observationsCachePath: string;
  modelsCachePath: string;
  maxPendingRows: number;
  flushOnDispose?: boolean;
}

interface SerializedOiSnapshot extends Omit<PersistedOiSnapshot, 'snapshotTs'> {
  snapshotTs: string;
}

interface SerializedDealerPosition extends Omit<PersistedDealerPosition, 'lastSnapshotTs'> {
  lastSnapshotTs: string;
}

interface SerializedIvHistoryPoint extends Omit<PersistedIvHistoryPoint, 'ts'> {
  ts: string;
}

interface SerializedRegimeObservation extends Omit<PersistedRegimeObservation, 'ts'> {
  ts: string;
}

interface SerializedRegimeModel extends Omit<PersistedRegimeModel, 'fittedAt'> {
  fittedAt: string;
}

type DeferredLog = { warn: (obj: object, msg: string) => void };

function ensureCacheDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readJsonLines<T>(path: string, decode: (value: unknown) => T): T[] {
  if (!existsSync(path)) return [];
  const body = readFileSync(path, 'utf8');
  return body
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => decode(JSON.parse(line)));
}

function appendJsonLines<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  if (rows.length === 0) return;
  ensureCacheDir(path);
  appendFileSync(path, rows.map((row) => JSON.stringify(encode(row))).join('\n') + '\n');
}

function rewriteJsonLines<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  ensureCacheDir(path);
  if (rows.length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeAtomically(path, rows.map((row) => JSON.stringify(encode(row))).join('\n') + '\n');
}

function rewriteOutbox<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  const body = rows.map((row) => JSON.stringify(encode(row))).join('\n');
  writeAtomically(path, rows.length > 0 ? `${body}\n` : '');
}

function writeAtomically(path: string, body: string): void {
  ensureCacheDir(path);
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, body);
  renameSync(temporaryPath, path);
}

function decodeOiSnapshot(value: unknown): PersistedOiSnapshot {
  const row = value as SerializedOiSnapshot;
  return { ...row, snapshotTs: new Date(row.snapshotTs) };
}

function encodeOiSnapshot(row: PersistedOiSnapshot): SerializedOiSnapshot {
  return { ...row, snapshotTs: row.snapshotTs.toISOString() };
}

function dealerKey(row: PersistedDealerPosition): string {
  return `${row.venue}:${row.instrumentName}`;
}

function decodeDealerPosition(value: unknown): PersistedDealerPosition {
  const row = value as SerializedDealerPosition;
  return { ...row, lastSnapshotTs: new Date(row.lastSnapshotTs) };
}

function encodeDealerPosition(row: PersistedDealerPosition): SerializedDealerPosition {
  return { ...row, lastSnapshotTs: row.lastSnapshotTs.toISOString() };
}

function decodeIvHistoryPoint(value: unknown): PersistedIvHistoryPoint {
  const row = value as SerializedIvHistoryPoint;
  return { ...row, ts: new Date(row.ts) };
}

function encodeIvHistoryPoint(row: PersistedIvHistoryPoint): SerializedIvHistoryPoint {
  return { ...row, ts: row.ts.toISOString() };
}

function decodeRegimeObservation(value: unknown): PersistedRegimeObservation {
  const row = value as SerializedRegimeObservation;
  return { ...row, ts: new Date(row.ts) };
}

function encodeRegimeObservation(row: PersistedRegimeObservation): SerializedRegimeObservation {
  return { ...row, ts: row.ts.toISOString() };
}

function decodeRegimeModel(value: unknown): PersistedRegimeModel {
  const row = value as SerializedRegimeModel;
  return { ...row, fittedAt: new Date(row.fittedAt) };
}

function encodeRegimeModel(row: PersistedRegimeModel): SerializedRegimeModel {
  return { ...row, fittedAt: row.fittedAt.toISOString() };
}

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function matchesIvHistoryQuery(row: PersistedIvHistoryPoint, query: IvHistoryLoadQuery): boolean {
  const allowed = new Set(query.underlyings.map((underlying) => underlying.toUpperCase()));
  return allowed.has(row.underlying.toUpperCase()) && row.ts >= query.since;
}

function matchesRegimeObservationQuery(
  row: PersistedRegimeObservation,
  query: RegimeObservationLoadQuery,
): boolean {
  const allowed = new Set(query.underlyings.map((underlying) => underlying.toUpperCase()));
  return allowed.has(row.underlying.toUpperCase()) && row.ts >= query.since;
}

export class DeferredOiSnapshotStore implements OiSnapshotStore {
  readonly enabled: boolean;
  private pending: PersistedOiSnapshot[];
  private pruneBefore: Date | null = null;
  private flushing = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly delegate: OiSnapshotStore,
    private readonly options: DeferredPersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.pending = readJsonLines(options.cachePath, decodeOiSnapshot);
    this.timer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        this.log.warn(
          { err: String(err), pending: this.pending.length },
          'deferred OI flush failed',
        );
      });
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  async writeMany(rows: PersistedOiSnapshot[]): Promise<void> {
    if (rows.length === 0) return;
    this.pending.push(...rows);
    if (this.pending.length > this.options.maxPendingRows) {
      this.pending.splice(0, this.pending.length - this.options.maxPendingRows);
      rewriteJsonLines(this.options.cachePath, this.pending, encodeOiSnapshot);
      return;
    }
    appendJsonLines(this.options.cachePath, rows, encodeOiSnapshot);
  }

  async prune(before: Date): Promise<number> {
    if (this.pruneBefore == null || before > this.pruneBefore) this.pruneBefore = before;
    return 0;
  }

  async flush(): Promise<void> {
    if (this.flushing || (this.pending.length === 0 && this.pruneBefore == null)) return;
    this.flushing = true;
    const batch = this.pending;
    const pruneBefore = this.pruneBefore;
    this.pending = [];
    this.pruneBefore = null;

    try {
      await this.delegate.writeMany(batch);
      if (pruneBefore != null) await this.delegate.prune(pruneBefore);
      rewriteJsonLines(this.options.cachePath, this.pending, encodeOiSnapshot);
    } catch (err) {
      this.pending = [...batch, ...this.pending];
      this.pruneBefore = pruneBefore;
      rewriteJsonLines(this.options.cachePath, this.pending, encodeOiSnapshot);
      throw err;
    } finally {
      this.flushing = false;
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer);
    if (this.options.flushOnDispose === true) await this.flush();
    await this.delegate.dispose();
  }
}

export class DeferredDealerBookStore implements DealerBookStore {
  readonly enabled: boolean;
  private readonly cache: Map<string, PersistedDealerPosition>;
  private pending: Map<string, PersistedDealerPosition>;
  private readonly pendingPath: string;
  private pruneBeforeExpiry: string | null = null;
  private flushing = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly delegate: DealerBookStore,
    private readonly options: DeferredPersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.pendingPath = `${options.cachePath}.pending`;
    this.cache = new Map(
      readJsonLines(options.cachePath, decodeDealerPosition).map((row) => [dealerKey(row), row]),
    );
    this.pending = existsSync(this.pendingPath)
      ? new Map(
          readJsonLines(this.pendingPath, decodeDealerPosition).map((row) => [dealerKey(row), row]),
        )
      : new Map(this.cache);
    this.timer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        this.log.warn(
          { err: String(err), pending: this.pending.size },
          'deferred dealer-book flush failed',
        );
      });
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  async loadAll(underlyings: string[]): Promise<PersistedDealerPosition[]> {
    const allowed = new Set(underlyings.map((underlying) => underlying.toUpperCase()));
    if (this.cache.size > 0) {
      return [...this.cache.values()].filter((row) => allowed.has(row.underlying.toUpperCase()));
    }

    const rows = new Map(
      (await this.delegate.loadAll(underlyings)).map((row) => [dealerKey(row), row]),
    );
    for (const [key, row] of rows) this.cache.set(key, row);
    this.rewriteCache();
    this.rewritePending();
    return [...rows.values()];
  }

  async upsertMany(positions: PersistedDealerPosition[]): Promise<void> {
    for (const position of positions) {
      const key = dealerKey(position);
      this.cache.set(key, position);
      this.pending.set(key, position);
    }
    while (this.cache.size > this.options.maxPendingRows) {
      const first = this.cache.keys().next().value;
      if (first == null) break;
      this.cache.delete(first);
      this.pending.delete(first);
    }
    this.rewriteCache();
    this.rewritePending();
  }

  async pruneExpired(beforeExpiry: string): Promise<number> {
    let pruned = 0;
    for (const [key, row] of this.cache) {
      if (row.expiry != null && row.expiry < beforeExpiry) {
        this.cache.delete(key);
        this.pending.delete(key);
        pruned += 1;
      }
    }
    if (this.pruneBeforeExpiry == null || beforeExpiry > this.pruneBeforeExpiry) {
      this.pruneBeforeExpiry = beforeExpiry;
    }
    this.rewriteCache();
    this.rewritePending();
    return pruned;
  }

  async flush(): Promise<void> {
    if (this.flushing || (this.pending.size === 0 && this.pruneBeforeExpiry == null)) return;
    this.flushing = true;
    const batch = [...this.pending.values()];
    const pruneBeforeExpiry = this.pruneBeforeExpiry;
    this.pruneBeforeExpiry = null;

    try {
      await this.delegate.upsertMany(batch);
      if (pruneBeforeExpiry != null) await this.delegate.pruneExpired(pruneBeforeExpiry);
      for (const row of batch) {
        const key = dealerKey(row);
        if (this.pending.get(key) === row) this.pending.delete(key);
      }
      this.rewritePending();
    } catch (err) {
      this.pruneBeforeExpiry = pruneBeforeExpiry;
      this.rewritePending();
      throw err;
    } finally {
      this.flushing = false;
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer);
    if (this.options.flushOnDispose === true) await this.flush();
    await this.delegate.dispose();
  }

  private rewritePending(): void {
    rewriteOutbox(this.pendingPath, [...this.pending.values()], encodeDealerPosition);
  }

  private rewriteCache(): void {
    rewriteJsonLines(this.options.cachePath, [...this.cache.values()], encodeDealerPosition);
  }
}

export class DeferredIvHistoryStore implements IvHistoryStore {
  readonly enabled: boolean;
  private cache: PersistedIvHistoryPoint[];
  private pending: PersistedIvHistoryPoint[];
  private readonly pendingPath: string;
  private flushing = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly delegate: IvHistoryStore,
    private readonly options: DeferredPersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.pendingPath = `${options.cachePath}.pending`;
    this.cache = readJsonLines(options.cachePath, decodeIvHistoryPoint);
    this.pending = existsSync(this.pendingPath)
      ? readJsonLines(this.pendingPath, decodeIvHistoryPoint)
      : [...this.cache];
    this.timer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        this.log.warn(
          { err: String(err), pending: this.pending.length },
          'deferred IV-history flush failed',
        );
      });
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  async writeMany(points: PersistedIvHistoryPoint[]): Promise<void> {
    if (points.length === 0) return;
    this.cache.push(...points);
    this.pending.push(...points);
    if (this.cache.length > this.options.maxPendingRows) {
      this.cache.splice(0, this.cache.length - this.options.maxPendingRows);
      rewriteJsonLines(this.options.cachePath, this.cache, encodeIvHistoryPoint);
    } else {
      appendJsonLines(this.options.cachePath, points, encodeIvHistoryPoint);
    }
    if (this.pending.length > this.options.maxPendingRows) {
      this.pending.splice(0, this.pending.length - this.options.maxPendingRows);
      rewriteOutbox(this.pendingPath, this.pending, encodeIvHistoryPoint);
    } else {
      appendJsonLines(this.pendingPath, points, encodeIvHistoryPoint);
    }
  }

  async loadSince(query: IvHistoryLoadQuery): Promise<PersistedIvHistoryPoint[]> {
    const rows = this.cache.filter((row) => matchesIvHistoryQuery(row, query));
    if (rows.length > 0) return rows.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    return this.delegate.loadSince(query);
  }

  async getStorageStats(): Promise<IvHistoryStorageStats> {
    const bytes = fileSize(this.options.cachePath);
    const thresholdBytes = this.options.thresholdBytes ?? 0;
    return {
      enabled: this.enabled,
      bytes,
      thresholdBytes,
      warning: thresholdBytes > 0 && bytes >= thresholdBytes,
    };
  }

  async flush(): Promise<void> {
    if (this.flushing || this.pending.length === 0) return;
    this.flushing = true;
    const batch = [...this.pending];
    try {
      await this.delegate.writeMany(batch);
      const flushed = new Set(batch);
      this.pending = this.pending.filter((row) => !flushed.has(row));
      rewriteOutbox(this.pendingPath, this.pending, encodeIvHistoryPoint);
    } finally {
      this.flushing = false;
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer);
    if (this.options.flushOnDispose === true) await this.flush();
    await this.delegate.dispose();
  }
}

export class DeferredRegimeStore implements RegimeStore {
  readonly enabled: boolean;
  private observations: PersistedRegimeObservation[];
  private pendingObservations: PersistedRegimeObservation[];
  private readonly models: Map<string, PersistedRegimeModel>;
  private pendingModels: Map<string, PersistedRegimeModel>;
  private readonly pendingObservationsPath: string;
  private readonly pendingModelsPath: string;
  private flushing = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly delegate: RegimeStore,
    private readonly options: DeferredRegimePersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.pendingObservationsPath = `${options.observationsCachePath}.pending`;
    this.pendingModelsPath = `${options.modelsCachePath}.pending`;
    this.observations = readJsonLines(options.observationsCachePath, decodeRegimeObservation);
    this.models = new Map(
      readJsonLines(options.modelsCachePath, decodeRegimeModel).map((model) => [
        model.underlying.toUpperCase(),
        model,
      ]),
    );
    this.pendingObservations = existsSync(this.pendingObservationsPath)
      ? readJsonLines(this.pendingObservationsPath, decodeRegimeObservation)
      : [...this.observations];
    this.pendingModels = existsSync(this.pendingModelsPath)
      ? new Map(
          readJsonLines(this.pendingModelsPath, decodeRegimeModel).map((model) => [
            model.underlying.toUpperCase(),
            model,
          ]),
        )
      : new Map(this.models);
    this.timer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        this.log.warn(
          {
            err: String(err),
            observations: this.pendingObservations.length,
            models: this.pendingModels.size,
          },
          'deferred regime flush failed',
        );
      });
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  async loadModel(underlying: string): Promise<PersistedRegimeModel | null> {
    return this.models.get(underlying.toUpperCase()) ?? this.delegate.loadModel(underlying);
  }

  async saveModel(model: PersistedRegimeModel): Promise<void> {
    const key = model.underlying.toUpperCase();
    this.models.set(key, model);
    this.pendingModels.set(key, model);
    rewriteJsonLines(this.options.modelsCachePath, [...this.models.values()], encodeRegimeModel);
    rewriteOutbox(this.pendingModelsPath, [...this.pendingModels.values()], encodeRegimeModel);
  }

  async loadObservationsSince(
    query: RegimeObservationLoadQuery,
  ): Promise<PersistedRegimeObservation[]> {
    const rows = this.observations.filter((row) => matchesRegimeObservationQuery(row, query));
    if (rows.length > 0) return rows.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    return this.delegate.loadObservationsSince(query);
  }

  async saveObservation(row: PersistedRegimeObservation): Promise<void> {
    this.observations.push(row);
    this.pendingObservations.push(row);
    if (this.observations.length > this.options.maxPendingRows) {
      this.observations.splice(0, this.observations.length - this.options.maxPendingRows);
      rewriteJsonLines(
        this.options.observationsCachePath,
        this.observations,
        encodeRegimeObservation,
      );
    } else {
      appendJsonLines(this.options.observationsCachePath, [row], encodeRegimeObservation);
    }
    if (this.pendingObservations.length > this.options.maxPendingRows) {
      this.pendingObservations.splice(
        0,
        this.pendingObservations.length - this.options.maxPendingRows,
      );
      rewriteOutbox(
        this.pendingObservationsPath,
        this.pendingObservations,
        encodeRegimeObservation,
      );
    } else {
      appendJsonLines(this.pendingObservationsPath, [row], encodeRegimeObservation);
    }
  }

  async flush(): Promise<void> {
    if (
      this.flushing ||
      (this.pendingObservations.length === 0 && this.pendingModels.size === 0)
    ) {
      return;
    }
    this.flushing = true;
    const observations = [...this.pendingObservations];
    const models = new Map(this.pendingModels);
    try {
      for (const model of models.values()) await this.delegate.saveModel(model);
      for (const observation of observations) await this.delegate.saveObservation(observation);
      const flushedObservations = new Set(observations);
      this.pendingObservations = this.pendingObservations.filter(
        (observation) => !flushedObservations.has(observation),
      );
      for (const [key, model] of models) {
        if (this.pendingModels.get(key) === model) this.pendingModels.delete(key);
      }
      this.rewritePending();
    } finally {
      this.flushing = false;
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer);
    if (this.options.flushOnDispose === true) await this.flush();
    await this.delegate.dispose();
  }

  private rewritePending(): void {
    rewriteOutbox(
      this.pendingObservationsPath,
      this.pendingObservations,
      encodeRegimeObservation,
    );
    rewriteOutbox(this.pendingModelsPath, [...this.pendingModels.values()], encodeRegimeModel);
  }
}
