import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

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

interface DeferredTradeStoreOptions {
  flushIntervalMs: number;
  cachePath: string;
  maxPendingRows: number;
  flushBatchSize?: number;
  flushOnDispose?: boolean;
}

interface SerializedTradeRecord extends Omit<PersistedTradeRecord, 'tradeTs' | 'ingestedAt'> {
  tradeTs: string;
  ingestedAt: string;
  _queuedAt?: number;
}

interface CachedTradeRecord {
  record: PersistedTradeRecord;
  queuedAt: number | null;
}

type DeferredTradeLog = { warn: (obj: object, msg: string) => void };

const DEFAULT_FLUSH_BATCH_SIZE = 10_000;
const IO_CHUNK_BYTES = 64 * 1024;

export class DeferredTradeStore implements TradeStore {
  readonly enabled: boolean;
  private readonly flushingPath: string;
  private readonly flushBatchSize: number;
  private pendingCount = 0;
  private oldestPendingAt: number | null = null;
  private capacityWarningEmitted = false;
  private ensureMonthsAhead: number | null = null;
  private pruneBefore: Date | null = null;
  private flushPromise: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryNotBefore = 0;
  private maintenanceDueAt: number;
  private disposed = false;

  constructor(
    private readonly delegate: TradeStore,
    private readonly options: DeferredTradeStoreOptions,
    private readonly log: DeferredTradeLog,
  ) {
    this.enabled = delegate.enabled;
    this.flushingPath = `${options.cachePath}.flushing`;
    this.flushBatchSize = options.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
    this.maintenanceDueAt = Date.now() + options.flushIntervalMs;
    this.recoverInterruptedFlush();
    this.refreshPendingState();
    this.scheduleNextFlush();
  }

  async writeMany(records: PersistedTradeRecord[]): Promise<void> {
    if (records.length === 0) return;
    const queuedAt = Date.now();
    appendJsonLines(this.options.cachePath, records, (record) =>
      encodeTradeRecord(record, queuedAt),
    );
    if (this.oldestPendingAt == null) this.oldestPendingAt = queuedAt;
    this.pendingCount += records.length;

    if (this.pendingCount > this.options.maxPendingRows && !this.capacityWarningEmitted) {
      this.capacityWarningEmitted = true;
      this.log.warn(
        { pending: this.pendingCount, warningThreshold: this.options.maxPendingRows },
        'deferred trade spool exceeded warning threshold; retaining all rows',
      );
    }

    if (this.flushPromise == null) this.scheduleNextFlush();
  }

  async loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    return this.delegate.loadRecent(query);
  }

  async loadHistory(query: TradeHistoryQuery): Promise<PersistedTradeRecord[]> {
    return this.delegate.loadHistory(query);
  }

  async summarizeHistory(
    query: TradeFilterQuery & { mode: PersistedTradeRecord['mode'] },
  ): Promise<TradeHistorySummary> {
    return this.delegate.summarizeHistory(query);
  }

  async listInstruments(query: InstrumentListQuery): Promise<InstrumentSummary[]> {
    return this.delegate.listInstruments(query);
  }

  async pruneHistory(beforeTs: Date): Promise<TradePruneResult> {
    if (this.pruneBefore == null || beforeTs > this.pruneBefore) this.pruneBefore = beforeTs;
    return { deleted: 0 };
  }

  async ensureForwardPartitions(monthsAhead: number): Promise<void> {
    this.ensureMonthsAhead = Math.max(this.ensureMonthsAhead ?? monthsAhead, monthsAhead);
  }

  async flush(): Promise<void> {
    if (this.flushPromise != null) return this.flushPromise;

    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    let failed = false;
    const flushPromise = this.performFlush().catch((error: unknown) => {
      failed = true;
      throw error;
    });
    this.flushPromise = flushPromise;

    try {
      await flushPromise;
    } finally {
      if (this.flushPromise === flushPromise) this.flushPromise = null;
      this.retryNotBefore = failed ? Date.now() + this.retryDelayMs() : 0;
      this.scheduleNextFlush();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.options.flushOnDispose === true) await this.flush();
    else if (this.flushPromise != null) await this.flushPromise;
    await this.delegate.dispose();
  }

  private async performFlush(): Promise<void> {
    const shouldFlushRows = existsSync(this.options.cachePath);
    const shouldFlushMaintenance = this.ensureMonthsAhead != null || this.pruneBefore != null;
    if (!shouldFlushRows && !shouldFlushMaintenance) {
      this.maintenanceDueAt = Date.now() + this.options.flushIntervalMs;
      return;
    }

    const ensureMonthsAhead = this.ensureMonthsAhead;
    const pruneBefore = this.pruneBefore;
    const flushingOldestPendingAt = this.oldestPendingAt;
    this.ensureMonthsAhead = null;
    this.pruneBefore = null;

    try {
      if (shouldFlushRows) renameSync(this.options.cachePath, this.flushingPath);
      this.pendingCount = 0;
      this.oldestPendingAt = null;
      this.capacityWarningEmitted = false;
      if (ensureMonthsAhead != null) await this.delegate.ensureForwardPartitions(ensureMonthsAhead);
      if (existsSync(this.flushingPath)) await this.flushFile(this.flushingPath);
      if (pruneBefore != null) await this.delegate.pruneHistory(pruneBefore);
      if (existsSync(this.flushingPath)) unlinkSync(this.flushingPath);
      this.maintenanceDueAt = Date.now() + this.options.flushIntervalMs;
    } catch (err) {
      this.ensureMonthsAhead = ensureMonthsAhead;
      this.pruneBefore = pruneBefore;
      this.restoreFlushingFile();
      this.refreshPendingState(flushingOldestPendingAt);
      throw err;
    }
  }

  private async flushFile(path: string): Promise<void> {
    let batch: PersistedTradeRecord[] = [];
    for (const { record } of readJsonLines(path, decodeCachedTradeRecord)) {
      batch.push(record);
      if (batch.length === this.flushBatchSize) {
        await this.delegate.writeMany(batch);
        batch = [];
      }
    }
    if (batch.length > 0) await this.delegate.writeMany(batch);
  }

  private recoverInterruptedFlush(): void {
    if (!existsSync(this.flushingPath)) return;
    this.restoreFlushingFile();
  }

  private restoreFlushingFile(): void {
    if (!existsSync(this.flushingPath)) return;
    if (existsSync(this.options.cachePath)) {
      appendFileContentsSync(this.options.cachePath, this.flushingPath);
      unlinkSync(this.options.cachePath);
    }
    ensureCacheDir(this.options.cachePath);
    renameSync(this.flushingPath, this.options.cachePath);
  }

  private refreshPendingState(fallbackOldestPendingAt: number | null = null): void {
    let pendingCount = 0;
    let oldestQueuedAt: number | null = null;
    let hasMissingQueuedAt = false;
    for (const cached of readJsonLines(this.options.cachePath, decodeCachedTradeRecord)) {
      pendingCount += 1;
      if (cached.queuedAt == null) hasMissingQueuedAt = true;
      else if (oldestQueuedAt == null || cached.queuedAt < oldestQueuedAt) {
        oldestQueuedAt = cached.queuedAt;
      }
    }

    this.pendingCount = pendingCount;
    this.oldestPendingAt = hasMissingQueuedAt ? fallbackOldestPendingAt : oldestQueuedAt;
    if (this.pendingCount > 0 && this.oldestPendingAt == null) {
      this.oldestPendingAt = Date.now() - this.options.flushIntervalMs;
    }
    this.capacityWarningEmitted = this.pendingCount > this.options.maxPendingRows;
  }

  private scheduleNextFlush(): void {
    if (this.disposed || this.flushPromise != null) return;
    if (this.timer != null) clearTimeout(this.timer);

    const pendingDueAt =
      this.oldestPendingAt == null
        ? Number.POSITIVE_INFINITY
        : this.oldestPendingAt + this.options.flushIntervalMs;
    const dueAt = Math.max(this.retryNotBefore, Math.min(pendingDueAt, this.maintenanceDueAt));
    const delay = Math.max(0, dueAt - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch((err: unknown) => {
        this.log.warn(
          { err: String(err), pending: this.pendingCount },
          'deferred trade flush failed',
        );
      });
    }, delay);
    this.timer.unref?.();
  }

  private retryDelayMs(): number {
    return this.options.flushIntervalMs;
  }
}

function ensureCacheDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function* readJsonLines<T>(path: string, decode: (value: unknown) => T): Generator<T> {
  if (!existsSync(path)) return;
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  const decoder = new StringDecoder('utf8');
  let remainder = '';

  try {
    let bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      const body = remainder + decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newline = body.indexOf('\n', lineStart);
      while (newline !== -1) {
        const line = body.slice(lineStart, newline);
        if (line.trim() !== '') yield decode(JSON.parse(line));
        lineStart = newline + 1;
        newline = body.indexOf('\n', lineStart);
      }
      remainder = body.slice(lineStart);
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    }
    const finalLine = remainder + decoder.end();
    if (finalLine.trim() !== '') yield decode(JSON.parse(finalLine));
  } finally {
    closeSync(descriptor);
  }
}

function appendJsonLines<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  if (rows.length === 0) return;
  ensureCacheDir(path);
  const descriptor = openSync(path, 'a');
  const buffer = Buffer.from(rows.map((row) => JSON.stringify(encode(row))).join('\n') + '\n');
  try {
    let offset = 0;
    while (offset < buffer.length) {
      offset += writeSync(descriptor, buffer, offset, buffer.length - offset);
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function appendFileContentsSync(sourcePath: string, destinationPath: string): void {
  const source = openSync(sourcePath, 'r');
  const destination = openSync(destinationPath, 'a');
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);

  try {
    let bytesRead = readSync(source, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      let offset = 0;
      while (offset < bytesRead) {
        offset += writeSync(destination, buffer, offset, bytesRead - offset);
      }
      bytesRead = readSync(source, buffer, 0, buffer.length, null);
    }
    fsyncSync(destination);
  } finally {
    closeSync(destination);
    closeSync(source);
  }
}

function decodeCachedTradeRecord(value: unknown): CachedTradeRecord {
  const row = value as SerializedTradeRecord;
  const { _queuedAt, ...record } = row;
  return {
    record: {
      ...record,
      tradeTs: new Date(record.tradeTs),
      ingestedAt: new Date(record.ingestedAt),
    },
    queuedAt: typeof _queuedAt === 'number' && Number.isFinite(_queuedAt) ? _queuedAt : null,
  };
}

function encodeTradeRecord(row: PersistedTradeRecord, queuedAt: number): SerializedTradeRecord {
  return {
    ...row,
    tradeTs: row.tradeTs.toISOString(),
    ingestedAt: row.ingestedAt.toISOString(),
    _queuedAt: queuedAt,
  };
}
