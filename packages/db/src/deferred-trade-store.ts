import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
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
}

type DeferredTradeLog = { warn: (obj: object, msg: string) => void };

const DEFAULT_FLUSH_BATCH_SIZE = 10_000;

export class DeferredTradeStore implements TradeStore {
  readonly enabled: boolean;
  private readonly flushingPath: string;
  private readonly flushBatchSize: number;
  private pendingCount = 0;
  private ensureMonthsAhead: number | null = null;
  private pruneBefore: Date | null = null;
  private flushing = false;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly delegate: TradeStore,
    private readonly options: DeferredTradeStoreOptions,
    private readonly log: DeferredTradeLog,
  ) {
    this.enabled = delegate.enabled;
    this.flushingPath = `${options.cachePath}.flushing`;
    this.flushBatchSize = options.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
    this.recoverInterruptedFlush();
    this.pendingCount = countCachedRows(options.cachePath);
    this.timer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        this.log.warn({ err: String(err), pending: this.pendingCount }, 'deferred trade flush failed');
      });
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  async writeMany(records: PersistedTradeRecord[]): Promise<void> {
    if (records.length === 0) return;
    appendJsonLines(this.options.cachePath, records, encodeTradeRecord);
    this.pendingCount += records.length;

    if (this.pendingCount > this.options.maxPendingRows) {
      const rows = readJsonLines(this.options.cachePath, decodeTradeRecord).slice(
        -this.options.maxPendingRows,
      );
      rewriteJsonLines(this.options.cachePath, rows, encodeTradeRecord);
      this.pendingCount = rows.length;
    }
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
    if (this.flushing) return;
    const shouldFlushRows = existsSync(this.options.cachePath);
    const shouldFlushMaintenance = this.ensureMonthsAhead != null || this.pruneBefore != null;
    if (!shouldFlushRows && !shouldFlushMaintenance) return;

    this.flushing = true;
    const ensureMonthsAhead = this.ensureMonthsAhead;
    const pruneBefore = this.pruneBefore;
    this.ensureMonthsAhead = null;
    this.pruneBefore = null;

    try {
      if (shouldFlushRows) renameSync(this.options.cachePath, this.flushingPath);
      this.pendingCount = countCachedRows(this.options.cachePath);
      if (ensureMonthsAhead != null) await this.delegate.ensureForwardPartitions(ensureMonthsAhead);
      if (existsSync(this.flushingPath)) await this.flushFile(this.flushingPath);
      if (pruneBefore != null) await this.delegate.pruneHistory(pruneBefore);
      if (existsSync(this.flushingPath)) unlinkSync(this.flushingPath);
    } catch (err) {
      this.ensureMonthsAhead = ensureMonthsAhead;
      this.pruneBefore = pruneBefore;
      this.restoreFlushingFile();
      this.pendingCount = countCachedRows(this.options.cachePath);
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

  private async flushFile(path: string): Promise<void> {
    const rows = readJsonLines(path, decodeTradeRecord);
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

function rewriteJsonLines<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  ensureCacheDir(path);
  if (rows.length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeFileSync(path, rows.map((row) => JSON.stringify(encode(row))).join('\n') + '\n');
}

function countCachedRows(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '').length;
}

function decodeTradeRecord(value: unknown): PersistedTradeRecord {
  const row = value as SerializedTradeRecord;
  return { ...row, tradeTs: new Date(row.tradeTs), ingestedAt: new Date(row.ingestedAt) };
}

function encodeTradeRecord(row: PersistedTradeRecord): SerializedTradeRecord {
  return {
    ...row,
    tradeTs: row.tradeTs.toISOString(),
    ingestedAt: row.ingestedAt.toISOString(),
  };
}
