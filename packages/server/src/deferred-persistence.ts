import { dirname } from 'node:path';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import type {
  DealerBookStore,
  OiSnapshotStore,
  PersistedDealerPosition,
  PersistedOiSnapshot,
} from '@oggregator/db';

interface DeferredPersistenceOptions {
  flushIntervalMs: number;
  cachePath: string;
  maxPendingRows: number;
}

interface SerializedOiSnapshot extends Omit<PersistedOiSnapshot, 'snapshotTs'> {
  snapshotTs: string;
}

interface SerializedDealerPosition extends Omit<PersistedDealerPosition, 'lastSnapshotTs'> {
  lastSnapshotTs: string;
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
  writeFileSync(path, rows.map((row) => JSON.stringify(encode(row))).join('\n') + '\n');
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
        this.log.warn({ err: String(err), pending: this.pending.length }, 'deferred OI flush failed');
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
    await this.flush();
    await this.delegate.dispose();
  }
}

export class DeferredDealerBookStore implements DealerBookStore {
  readonly enabled: boolean;
  private pending: Map<string, PersistedDealerPosition>;
  private pruneBeforeExpiry: string | null = null;
  private flushing = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly delegate: DealerBookStore,
    private readonly options: DeferredPersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.pending = new Map(
      readJsonLines(options.cachePath, decodeDealerPosition).map((row) => [dealerKey(row), row]),
    );
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
    const rows = new Map((await this.delegate.loadAll(underlyings)).map((row) => [dealerKey(row), row]));
    const allowed = new Set(underlyings.map((underlying) => underlying.toUpperCase()));
    for (const row of this.pending.values()) {
      if (allowed.has(row.underlying.toUpperCase())) rows.set(dealerKey(row), row);
    }
    return [...rows.values()];
  }

  async upsertMany(positions: PersistedDealerPosition[]): Promise<void> {
    for (const position of positions) this.pending.set(dealerKey(position), position);
    while (this.pending.size > this.options.maxPendingRows) {
      const first = this.pending.keys().next().value;
      if (first == null) break;
      this.pending.delete(first);
    }
    this.rewritePending();
  }

  async pruneExpired(beforeExpiry: string): Promise<number> {
    let pruned = 0;
    for (const [key, row] of this.pending) {
      if (row.expiry != null && row.expiry < beforeExpiry) {
        this.pending.delete(key);
        pruned += 1;
      }
    }
    if (this.pruneBeforeExpiry == null || beforeExpiry > this.pruneBeforeExpiry) {
      this.pruneBeforeExpiry = beforeExpiry;
    }
    this.rewritePending();
    return pruned;
  }

  async flush(): Promise<void> {
    if (this.flushing || (this.pending.size === 0 && this.pruneBeforeExpiry == null)) return;
    this.flushing = true;
    const batch = [...this.pending.values()];
    const pruneBeforeExpiry = this.pruneBeforeExpiry;
    this.pending.clear();
    this.pruneBeforeExpiry = null;

    try {
      await this.delegate.upsertMany(batch);
      if (pruneBeforeExpiry != null) await this.delegate.pruneExpired(pruneBeforeExpiry);
      this.rewritePending();
    } catch (err) {
      for (const position of batch) this.pending.set(dealerKey(position), position);
      this.pruneBeforeExpiry = pruneBeforeExpiry;
      this.rewritePending();
      throw err;
    } finally {
      this.flushing = false;
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
    await this.delegate.dispose();
  }

  private rewritePending(): void {
    rewriteJsonLines(this.options.cachePath, [...this.pending.values()], encodeDealerPosition);
  }
}
