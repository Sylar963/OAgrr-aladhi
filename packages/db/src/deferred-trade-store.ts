import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';

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
const MAX_RETRY_DELAY_MS = 60_000;

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
      this.scheduleNextFlush(failed ? Date.now() + this.retryDelayMs() : undefined);
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
    const rows = readJsonLines(path, decodeCachedTradeRecord).map(({ record }) => record);
    for (let index = 0; index < rows.length; index += this.flushBatchSize) {
      await this.delegate.writeMany(rows.slice(index, index + this.flushBatchSize));
    }
  }

  private recoverInterruptedFlush(): void {
    if (!existsSync(this.flushingPath)) return;
    this.restoreFlushingFile();
  }

  private restoreFlushingFile(): void {
    if (!existsSync(this.flushingPath)) return;
    if (existsSync(this.options.cachePath)) {
      appendFileSync(this.flushingPath, readFileSync(this.options.cachePath));
      unlinkSync(this.options.cachePath);
    }
    ensureCacheDir(this.options.cachePath);
    renameSync(this.flushingPath, this.options.cachePath);
  }

  private refreshPendingState(fallbackOldestPendingAt: number | null = null): void {
    const cached = readJsonLines(this.options.cachePath, decodeCachedTradeRecord);
    this.pendingCount = cached.length;
    this.oldestPendingAt = getOldestQueuedAt(cached) ?? fallbackOldestPendingAt;
    if (this.pendingCount > 0 && this.oldestPendingAt == null) {
      this.oldestPendingAt = Date.now() - this.options.flushIntervalMs;
    }
    this.capacityWarningEmitted = this.pendingCount > this.options.maxPendingRows;
  }

  private scheduleNextFlush(notBefore?: number): void {
    if (this.disposed || this.flushPromise != null) return;
    if (this.timer != null) clearTimeout(this.timer);

    const pendingDueAt =
      this.oldestPendingAt == null
        ? Number.POSITIVE_INFINITY
        : this.oldestPendingAt + this.options.flushIntervalMs;
    const dueAt = Math.max(notBefore ?? 0, Math.min(pendingDueAt, this.maintenanceDueAt));
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
    return Math.min(this.options.flushIntervalMs, MAX_RETRY_DELAY_MS);
  }
}

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

function getOldestQueuedAt(rows: CachedTradeRecord[]): number | null {
  let oldest: number | null = null;
  for (const row of rows) {
    if (row.queuedAt == null) return null;
    if (oldest == null || row.queuedAt < oldest) oldest = row.queuedAt;
  }
  return oldest;
}
