import { MergedTradeStore } from './merged-trade-store.js';
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
import type { PersistedTradeMode, PersistedTradeRecord } from './types.js';

export interface DeferredTradeStoreOptions {
  flushIntervalMs: number;
  retryDelayMs?: number;
  maintenanceIntervalMs?: number;
  sqlitePath: string;
  legacyCachePaths?: string[];
  maxPendingRows: number;
  flushBatchSize?: number;
  flushOnDispose?: boolean;
  busyTimeoutMs?: number;
}

export type DeferredTradeLog = { warn: (obj: object, msg: string) => void };

const DEFAULT_FLUSH_BATCH_SIZE = 10_000;

export class DeferredTradeStore implements TradeStore {
  readonly enabled: boolean;
  private readonly local: SqliteTradeStore;
  private readonly localReader: SqliteTradeStore;
  private readonly merged: MergedTradeStore;
  private readonly flushBatchSize: number;
  private readonly retryDelayMs: number;
  private readonly maintenanceIntervalMs: number;
  private pendingCount: number;
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
    this.validateOptions();
    this.enabled = delegate.enabled;
    this.flushBatchSize = options.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
    this.retryDelayMs = options.retryDelayMs ?? options.flushIntervalMs;
    this.maintenanceIntervalMs = options.maintenanceIntervalMs ?? options.flushIntervalMs;
    this.local = new SqliteTradeStore(options.sqlitePath, {
      ...(options.busyTimeoutMs == null ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
    });
    this.local.resetUploadAttempt();
    this.local.migrateLegacyFiles(options.legacyCachePaths ?? [], log);
    this.localReader = new SqliteTradeStore(options.sqlitePath, {
      readOnly: true,
      ...(options.busyTimeoutMs == null ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
    });
    this.merged = new MergedTradeStore(this.localReader, delegate, { disposeSources: false });
    this.pendingCount = this.local.countPending();
    this.capacityWarningEmitted = this.pendingCount > options.maxPendingRows;
    this.maintenanceDueAt = Date.now() + this.maintenanceIntervalMs;
    this.scheduleNextFlush();
  }

  async writeMany(records: PersistedTradeRecord[]): Promise<void> {
    if (records.length === 0) return;
    if (this.disposed) throw new Error('deferred trade store is disposed');
    this.pendingCount += this.local.writeMany(records);

    if (this.pendingCount > this.options.maxPendingRows && !this.capacityWarningEmitted) {
      this.capacityWarningEmitted = true;
      this.log.warn(
        { pending: this.pendingCount, warningThreshold: this.options.maxPendingRows },
        'deferred trade store exceeded warning threshold; retaining all rows',
      );
    }

    if (this.flushPromise == null) this.scheduleNextFlush();
  }

  async withReadSnapshot<T>(operation: () => Promise<T>): Promise<T> {
    return this.localReader.withReadSnapshot(() => this.delegate.withReadSnapshot(operation));
  }

  async loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    return this.merged.loadRecent(query);
  }

  async loadHistory(query: TradeHistoryQuery): Promise<PersistedTradeRecord[]> {
    return this.merged.loadHistory(query);
  }

  async loadByKeys(
    query: TradeFilterQuery,
    keys: TradeRecordKey[],
  ): Promise<PersistedTradeRecord[]> {
    const [localRows, remoteRows] = await Promise.all([
      this.local.loadByKeys(query, keys),
      this.delegate.loadByKeys(query, keys),
    ]);
    const rows = new Map<string, PersistedTradeRecord>();
    for (const row of remoteRows) rows.set(recordKey(row), row);
    for (const row of localRows) rows.set(recordKey(row), row);
    return [...rows.values()];
  }

  async summarizeHistory(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
  ): Promise<TradeHistorySummary> {
    return this.merged.summarizeHistory(query);
  }

  async listInstruments(query: InstrumentListQuery): Promise<InstrumentSummary[]> {
    return this.merged.listInstruments(query);
  }

  async listInstrumentsByNames(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
    instrumentNames: string[],
  ): Promise<InstrumentSummary[]> {
    const rows: InstrumentSummary[] = [];
    for (const instrumentName of instrumentNames) {
      rows.push(
        ...(await this.merged.listInstruments({
          ...query,
          instrumentName,
          limit: 1,
        })),
      );
    }
    return rows;
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

    const flushPromise = this.performFlush();
    this.flushPromise = flushPromise;
    try {
      await flushPromise;
    } finally {
      if (this.flushPromise === flushPromise) this.flushPromise = null;
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
    await Promise.all([this.local.dispose(), this.localReader.dispose(), this.delegate.dispose()]);
  }

  private async performFlush(): Promise<void> {
    const ensureMonthsAhead = this.ensureMonthsAhead;
    const pruneBefore = this.pruneBefore;
    const queuedThrough = Date.now();

    try {
      if (ensureMonthsAhead != null) await this.delegate.ensureForwardPartitions(ensureMonthsAhead);
      while (true) {
        const batch = this.local.loadPendingBatch(this.flushBatchSize, queuedThrough);
        if (batch.length === 0) break;
        await this.delegate.writeMany(batch);
        this.local.markUploaded(batch);
        if (batch.length < this.flushBatchSize) break;
      }
      if (pruneBefore != null) await this.delegate.pruneHistory(pruneBefore);
      await this.refreshRemoteHighWaterMarks();
      this.pendingCount -= this.local.deleteUploaded();
      this.ensureMonthsAhead = null;
      this.pruneBefore = null;
      this.local.setRetryNotBefore(0);
      this.maintenanceDueAt = Date.now() + this.maintenanceIntervalMs;
      this.capacityWarningEmitted = this.pendingCount > this.options.maxPendingRows;
    } catch (error: unknown) {
      this.local.resetUploadAttempt();
      this.local.setRetryNotBefore(Date.now() + this.retryDelayMs);
      throw error;
    }
  }

  private async refreshRemoteHighWaterMarks(): Promise<void> {
    for (const mode of ['live', 'institutional'] as const) {
      try {
        const latest = await this.delegate.loadRecent({ mode, limit: 1 });
        const tradeTs = latest[0]?.tradeTs.getTime();
        if (tradeTs != null) this.local.setRemoteMaxTradeTs(mode, tradeTs);
      } catch (error: unknown) {
        this.local.clearRemoteMaxTradeTs(mode);
        this.log.warn(
          { err: String(error), mode },
          'could not refresh remote trade history high-water mark',
        );
      }
    }
  }

  private scheduleNextFlush(): void {
    if (this.disposed || this.flushPromise != null) return;
    if (this.timer != null) clearTimeout(this.timer);
    const oldestQueuedAt = this.local.oldestQueuedAt();
    const pendingDueAt =
      oldestQueuedAt == null
        ? Number.POSITIVE_INFINITY
        : oldestQueuedAt + this.options.flushIntervalMs;
    const retryNotBefore = this.local.getRetryNotBefore();
    const dueAt = Math.max(retryNotBefore, Math.min(pendingDueAt, this.maintenanceDueAt));
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.flush().catch((error: unknown) => {
          this.log.warn(
            { err: String(error), pending: this.pendingCount },
            'deferred trade flush failed',
          );
        });
      },
      Math.max(0, dueAt - Date.now()),
    );
    this.timer.unref?.();
  }

  private validateOptions(): void {
    if (!Number.isInteger(this.options.flushIntervalMs) || this.options.flushIntervalMs <= 0) {
      throw new Error('flushIntervalMs must be a positive integer');
    }
    const flushBatchSize = this.options.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
    if (!Number.isInteger(flushBatchSize) || flushBatchSize <= 0) {
      throw new Error('flushBatchSize must be a positive integer');
    }
    if (!Number.isInteger(this.options.maxPendingRows) || this.options.maxPendingRows <= 0) {
      throw new Error('maxPendingRows must be a positive integer');
    }
    if (
      this.options.retryDelayMs != null &&
      (!Number.isInteger(this.options.retryDelayMs) || this.options.retryDelayMs <= 0)
    ) {
      throw new Error('retryDelayMs must be a positive integer');
    }
    if (
      this.options.maintenanceIntervalMs != null &&
      (!Number.isInteger(this.options.maintenanceIntervalMs) ||
        this.options.maintenanceIntervalMs <= 0)
    ) {
      throw new Error('maintenanceIntervalMs must be a positive integer');
    }
  }
}

function recordKey(record: TradeRecordKey): string {
  return `${record.tradeUid}\u0000${record.tradeTs.getTime()}`;
}
