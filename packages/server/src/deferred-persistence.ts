import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type {
  DealerBookStore,
  IvHistoryHourlyQuery,
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
  ShortStraddleSnapshotLoadQuery,
  ShortStraddleSnapshotStore,
} from '@oggregator/db';
import { z } from 'zod';

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

interface DeferredShortStraddlePersistenceOptions {
  flushIntervalMs: number;
  cachePath?: string;
  maxPendingRows?: number;
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

interface SerializedShortStraddleSnapshot
  extends Omit<
    PersistedShortStraddleSnapshot,
    | 'cohortSlotTs'
    | 'sampleSlotTs'
    | 'capturedAt'
    | 'expiryTs'
    | 'callQuoteTs'
    | 'putQuoteTs'
  > {
  cohortSlotTs: string;
  sampleSlotTs: string;
  capturedAt: string;
  expiryTs: string;
  callQuoteTs: string;
  putQuoteTs: string;
}

type DeferredLog = { warn: (obj: object, msg: string) => void };

const IO_CHUNK_BYTES = 64 * 1024;
const COPY_CHUNK_BYTES = 1024 * 1024;
const NEWLINE_BYTE = 0x0a;
const OI_FLUSH_BATCH_ROWS = 10_000;
const OI_TRIM_SLACK_RATIO = 0.1;
const WRITE_BUFFER_CHARACTERS = 1024 * 1024;
const DEFAULT_SHORT_STRADDLE_CACHE_PATH = '.cache/short-straddle-snapshots.ndjson';
const DEFAULT_SHORT_STRADDLE_MAX_PENDING_ROWS = 100_000;
const FiniteNumberSchema = z.number().finite();
const IsoDateSchema = z
  .string()
  .refine((value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  })
  .transform((value) => new Date(value));

const ShortStraddleSnapshotSchema = z
  .object({
    venue: z.string().min(1),
    underlying: z.string().min(1),
    cohortSlotTs: IsoDateSchema,
    horizonHours: z.union([z.literal(0), z.literal(1), z.literal(6), z.literal(24), z.literal(72)]),
    sampleSlotTs: IsoDateSchema,
    capturedAt: IsoDateSchema,
    expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expiryTs: IsoDateSchema,
    strike: FiniteNumberSchema,
    spotPriceUsd: FiniteNumberSchema,
    forwardPriceUsd: FiniteNumberSchema,
    callBidUsd: FiniteNumberSchema,
    callAskUsd: FiniteNumberSchema,
    callBidSize: FiniteNumberSchema,
    callAskSize: FiniteNumberSchema,
    callMarkIv: FiniteNumberSchema,
    callDelta: FiniteNumberSchema,
    callVegaUsdPerVolPoint: FiniteNumberSchema,
    callOpenInterest: FiniteNumberSchema,
    callMakerFeeUsd: FiniteNumberSchema,
    callTakerFeeUsd: FiniteNumberSchema,
    callAskMakerFeeUsd: FiniteNumberSchema,
    callAskTakerFeeUsd: FiniteNumberSchema,
    callQuoteTs: IsoDateSchema,
    putBidUsd: FiniteNumberSchema,
    putAskUsd: FiniteNumberSchema,
    putBidSize: FiniteNumberSchema,
    putAskSize: FiniteNumberSchema,
    putMarkIv: FiniteNumberSchema,
    putDelta: FiniteNumberSchema,
    putVegaUsdPerVolPoint: FiniteNumberSchema,
    putOpenInterest: FiniteNumberSchema,
    putMakerFeeUsd: FiniteNumberSchema,
    putTakerFeeUsd: FiniteNumberSchema,
    putAskMakerFeeUsd: FiniteNumberSchema,
    putAskTakerFeeUsd: FiniteNumberSchema,
    putQuoteTs: IsoDateSchema,
  })
  .strict();

function ensureCacheDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

const FIRST_FLUSH_DELAY_MS = 60_000;
const FLUSH_RETRY_MS = 15 * 60_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    return `${String(err)}: ${err.errors.map((inner: unknown) => String(inner)).join('; ')}`;
  }
  return String(err);
}

function readFlushMarker(path: string): number | null {
  try {
    const value = Number(readFileSync(path, 'utf8').trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

// A plain setInterval restarts its clock on every process start, so a daily flush never
// fires when the service restarts more often than that. The last successful flush time is
// kept next to the cache so the cadence survives restarts and an overdue backlog drains soon
// after startup.
export class FlushSchedule {
  private readonly markerPath: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    cachePath: string,
    private readonly intervalMs: number,
    private readonly run: () => Promise<void>,
    private readonly onError: (err: unknown) => void,
    now: number = Date.now(),
  ) {
    this.markerPath = `${cachePath}.last-flush`;
    const lastFlush = readFlushMarker(this.markerPath);
    const dueIn = lastFlush == null ? 0 : lastFlush + intervalMs - now;
    this.schedule(Math.max(FIRST_FLUSH_DELAY_MS, dueIn));
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.disposed) return;
    this.timer = setTimeout(() => void this.tick(), Math.min(delayMs, MAX_TIMEOUT_MS));
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.run();
      ensureCacheDir(this.markerPath);
      writeFileSync(this.markerPath, `${Date.now()}\n`);
      this.schedule(this.intervalMs);
    } catch (err: unknown) {
      this.onError(err);
      this.schedule(Math.min(this.intervalMs, FLUSH_RETRY_MS));
    }
  }
}

function readJsonLines<T>(path: string, decode: (value: unknown) => T, log: DeferredLog): T[] {
  if (!existsSync(path)) return [];
  const rows: T[] = [];
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
        decodeJsonLine(body.slice(lineStart, newline), decode, rows, path, log);
        lineStart = newline + 1;
        newline = body.indexOf('\n', lineStart);
      }
      remainder = body.slice(lineStart);
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    }
    decodeJsonLine(remainder + decoder.end(), decode, rows, path, log);
  } finally {
    closeSync(descriptor);
  }

  return rows;
}

function decodeJsonLine<T>(
  line: string,
  decode: (value: unknown) => T,
  rows: T[],
  path: string,
  log: DeferredLog,
): void {
  if (line.trim() === '') return;
  try {
    rows.push(decode(JSON.parse(line)));
  } catch (error: unknown) {
    log.warn({ err: String(error), path }, 'skipping malformed deferred cache line');
  }
}

function appendJsonLines<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  if (rows.length === 0) return;
  ensureCacheDir(path);
  const descriptor = openSync(path, 'a');
  try {
    writeJsonLines(descriptor, rows, encode);
  } finally {
    closeSync(descriptor);
  }
}

function rewriteJsonLines<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  ensureCacheDir(path);
  if (rows.length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  writeJsonLinesAtomically(path, rows, encode);
}

function rewriteOutbox<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  writeJsonLinesAtomically(path, rows, encode);
}

function writeJsonLinesAtomically<T>(path: string, rows: T[], encode: (row: T) => unknown): void {
  ensureCacheDir(path);
  const temporaryPath = `${path}.tmp`;
  const descriptor = openSync(temporaryPath, 'w');
  try {
    writeJsonLines(descriptor, rows, encode);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, path);
}

function writeJsonLines<T>(descriptor: number, rows: T[], encode: (row: T) => unknown): void {
  let body = '';
  for (const row of rows) {
    const line = `${JSON.stringify(encode(row))}\n`;
    if (body.length > 0 && body.length + line.length > WRITE_BUFFER_CHARACTERS) {
      writeString(descriptor, body);
      body = '';
    }
    if (line.length > WRITE_BUFFER_CHARACTERS) {
      writeString(descriptor, line);
    } else {
      body += line;
    }
  }
  if (body.length > 0) writeString(descriptor, body);
}

function writeString(descriptor: number, value: string): void {
  writeBuffer(descriptor, Buffer.from(value));
}

function writeBuffer(descriptor: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(descriptor, buffer, offset, buffer.length - offset);
  }
}

function* readJsonLineBatches<T>(
  path: string,
  decode: (value: unknown) => T,
  batchSize: number,
  log: DeferredLog,
): Generator<T[]> {
  if (!existsSync(path)) return;
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  const decoder = new StringDecoder('utf8');
  let remainder = '';
  let rows: T[] = [];

  try {
    let bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      const body = remainder + decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newline = body.indexOf('\n', lineStart);
      while (newline !== -1) {
        decodeJsonLine(body.slice(lineStart, newline), decode, rows, path, log);
        if (rows.length >= batchSize) {
          yield rows;
          rows = [];
        }
        lineStart = newline + 1;
        newline = body.indexOf('\n', lineStart);
      }
      remainder = body.slice(lineStart);
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    }
    decodeJsonLine(remainder + decoder.end(), decode, rows, path, log);
    if (rows.length > 0) yield rows;
  } finally {
    closeSync(descriptor);
  }
}

function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  let lines = 0;
  let lastByte = NEWLINE_BYTE;
  try {
    let bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      let index = buffer.indexOf(NEWLINE_BYTE, 0);
      while (index !== -1 && index < bytesRead) {
        lines += 1;
        index = buffer.indexOf(NEWLINE_BYTE, index + 1);
      }
      lastByte = buffer[bytesRead - 1] ?? NEWLINE_BYTE;
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(descriptor);
  }
  return lastByte === NEWLINE_BYTE ? lines : lines + 1;
}

function dropLeadingLines(path: string, count: number): void {
  if (count <= 0 || !existsSync(path)) return;
  const temporaryPath = `${path}.tmp`;
  const source = openSync(path, 'r');
  const target = openSync(temporaryPath, 'w');
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  let remaining = count;
  try {
    let bytesRead = readSync(source, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      let start = 0;
      while (remaining > 0) {
        const newline = buffer.indexOf(NEWLINE_BYTE, start);
        if (newline === -1 || newline >= bytesRead) {
          start = bytesRead;
          break;
        }
        remaining -= 1;
        start = newline + 1;
      }
      if (start < bytesRead) writeBuffer(target, buffer.subarray(start, bytesRead));
      bytesRead = readSync(source, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(source);
    closeSync(target);
  }
  renameSync(temporaryPath, path);
}

function appendFileContents(sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath)) return;
  const source = openSync(sourcePath, 'r');
  const target = openSync(targetPath, 'a');
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  try {
    let bytesRead = readSync(source, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      writeBuffer(target, buffer.subarray(0, bytesRead));
      bytesRead = readSync(source, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(source);
    closeSync(target);
  }
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
  // Rows cached before flow attribution existed carry no flowContracts; migration 0026 starts them at 0.
  return { ...row, flowContracts: row.flowContracts ?? 0, lastSnapshotTs: new Date(row.lastSnapshotTs) };
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

function decodeShortStraddleSnapshot(value: unknown): PersistedShortStraddleSnapshot {
  return ShortStraddleSnapshotSchema.parse(value);
}

function encodeShortStraddleSnapshot(
  row: PersistedShortStraddleSnapshot,
): SerializedShortStraddleSnapshot {
  return {
    ...row,
    cohortSlotTs: row.cohortSlotTs.toISOString(),
    sampleSlotTs: row.sampleSlotTs.toISOString(),
    capturedAt: row.capturedAt.toISOString(),
    expiryTs: row.expiryTs.toISOString(),
    callQuoteTs: row.callQuoteTs.toISOString(),
    putQuoteTs: row.putQuoteTs.toISOString(),
  };
}

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

const IV_CACHE_COVERAGE_SLACK_MS = 6 * 60 * 60 * 1000;

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

// Write-only outbox: nothing reads pending OI rows back, so they live only in the ndjson
// file. Holding the ~5M capped rows as objects cost ~1.5 GB of heap, and rewriting the
// whole file on every over-cap write blocked the event loop for ~25 s each dealer tick.
export class DeferredOiSnapshotStore implements OiSnapshotStore {
  readonly enabled: boolean;
  private pendingRows: number;
  private flushingRows = 0;
  private pruneBefore: Date | null = null;
  private flushing = false;
  private readonly flushingPath: string;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly delegate: OiSnapshotStore,
    private readonly options: DeferredPersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.flushingPath = `${options.cachePath}.flushing`;
    this.restoreInterruptedFlush();
    this.pendingRows = countLines(options.cachePath);
    // Still a plain interval: this outbox holds ~5M rows and draining it to Postgres needs a
    // deliberate decision about storage, not an automatic catch-up.
    this.timer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        this.log.warn(
          { err: describeError(err), pending: this.pendingCount },
          'deferred OI flush failed',
        );
      });
    }, options.flushIntervalMs);
    this.timer.unref?.();
  }

  get pendingCount(): number {
    return this.pendingRows + this.flushingRows;
  }

  async writeMany(rows: PersistedOiSnapshot[]): Promise<void> {
    if (rows.length === 0) return;
    appendJsonLines(this.options.cachePath, rows, encodeOiSnapshot);
    this.pendingRows += rows.length;
    const max = this.options.maxPendingRows;
    // Trimming copies the whole file, so let it overshoot by a slack before cutting back.
    if (this.pendingRows > max + Math.floor(max * OI_TRIM_SLACK_RATIO)) {
      dropLeadingLines(this.options.cachePath, this.pendingRows - max);
      this.pendingRows = max;
    }
  }

  async prune(before: Date): Promise<number> {
    if (this.pruneBefore == null || before > this.pruneBefore) this.pruneBefore = before;
    return 0;
  }

  async flush(): Promise<void> {
    if (this.flushing || (this.pendingRows === 0 && this.pruneBefore == null)) return;
    this.flushing = true;
    const pruneBefore = this.pruneBefore;
    this.pruneBefore = null;
    if (existsSync(this.options.cachePath)) renameSync(this.options.cachePath, this.flushingPath);
    this.flushingRows = this.pendingRows;
    this.pendingRows = 0;

    try {
      for (const batch of readJsonLineBatches(
        this.flushingPath,
        decodeOiSnapshot,
        OI_FLUSH_BATCH_ROWS,
        this.log,
      )) {
        await this.delegate.writeMany(batch);
      }
      if (pruneBefore != null) await this.delegate.prune(pruneBefore);
      if (existsSync(this.flushingPath)) unlinkSync(this.flushingPath);
      this.flushingRows = 0;
    } catch (err) {
      if (pruneBefore != null) await this.prune(pruneBefore);
      this.restoreInterruptedFlush();
      this.pendingRows += this.flushingRows;
      this.flushingRows = 0;
      throw err;
    } finally {
      this.flushing = false;
    }
  }

  private restoreInterruptedFlush(): void {
    if (!existsSync(this.flushingPath)) return;
    appendFileContents(this.options.cachePath, this.flushingPath);
    renameSync(this.flushingPath, this.options.cachePath);
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
  private readonly timer: FlushSchedule;

  constructor(
    private readonly delegate: DealerBookStore,
    private readonly options: DeferredPersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.pendingPath = `${options.cachePath}.pending`;
    this.cache = new Map(
      readJsonLines(options.cachePath, decodeDealerPosition, log).map((row) => [
        dealerKey(row),
        row,
      ]),
    );
    this.pending = existsSync(this.pendingPath)
      ? new Map(
          readJsonLines(this.pendingPath, decodeDealerPosition, log).map((row) => [
            dealerKey(row),
            row,
          ]),
        )
      : new Map(this.cache);
    this.timer = new FlushSchedule(
      options.cachePath,
      options.flushIntervalMs,
      () => this.flush(),
      (err: unknown) => {
        this.log.warn(
          { err: describeError(err), pending: this.pending.size },
          'deferred dealer-book flush failed',
        );
      },
    );
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
    this.timer.dispose();
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
  private readonly timer: FlushSchedule;

  constructor(
    private readonly delegate: IvHistoryStore,
    private readonly options: DeferredPersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.pendingPath = `${options.cachePath}.pending`;
    this.cache = readJsonLines(options.cachePath, decodeIvHistoryPoint, log);
    this.pending = existsSync(this.pendingPath)
      ? readJsonLines(this.pendingPath, decodeIvHistoryPoint, log)
      : [...this.cache];
    this.timer = new FlushSchedule(
      options.cachePath,
      options.flushIntervalMs,
      () => this.flush(),
      (err: unknown) => {
        this.log.warn(
          { err: describeError(err), pending: this.pending.length },
          'deferred IV-history flush failed',
        );
      },
    );
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
    const rows = this.cache
      .filter((row) => matchesIvHistoryQuery(row, query))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    if (rows.length === 0) return this.delegate.loadSince(query);

    // The local cache is row-capped, so its oldest rows can start well after `since`. Fill
    // the uncovered head of each underlying from Postgres instead of silently serving a
    // shorter window.
    const earliest = new Map<string, number>();
    for (const row of rows) {
      const key = row.underlying.toUpperCase();
      if (!earliest.has(key)) earliest.set(key, row.ts.getTime());
    }
    const sinceMs = query.since.getTime();
    const short = query.underlyings.some((underlying) => {
      const first = earliest.get(underlying.toUpperCase());
      return first == null || first - sinceMs > IV_CACHE_COVERAGE_SLACK_MS;
    });
    if (!short) return rows;

    try {
      const older = (await this.delegate.loadSince(query)).filter((row) => {
        const first = earliest.get(row.underlying.toUpperCase());
        return first == null || row.ts.getTime() < first;
      });
      if (older.length === 0) return rows;
      return [...older, ...rows].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    } catch (err: unknown) {
      this.log.warn({ err: describeError(err) }, 'IV-history backfill from storage failed');
      return rows;
    }
  }

  async loadHourly(query: IvHistoryHourlyQuery): Promise<PersistedIvHistoryPoint[]> {
    return this.delegate.loadHourly(query);
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
    this.timer.dispose();
    if (this.options.flushOnDispose === true) await this.flush();
    await this.delegate.dispose();
  }
}

export class DeferredShortStraddleSnapshotStore implements ShortStraddleSnapshotStore {
  readonly enabled: boolean;
  private readonly cachePath: string;
  private readonly maxPendingRows: number;
  private pending: PersistedShortStraddleSnapshot[];
  private flushPromise: Promise<void> | null = null;
  private warned = false;
  private readonly timer: FlushSchedule | null;

  constructor(
    private readonly delegate: ShortStraddleSnapshotStore,
    options: DeferredShortStraddlePersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.cachePath = options.cachePath ?? DEFAULT_SHORT_STRADDLE_CACHE_PATH;
    this.maxPendingRows = options.maxPendingRows ?? DEFAULT_SHORT_STRADDLE_MAX_PENDING_ROWS;
    this.pending = readJsonLines(this.cachePath, decodeShortStraddleSnapshot, log);
    this.timer =
      options.flushIntervalMs > 0
        ? new FlushSchedule(
            this.cachePath,
            options.flushIntervalMs,
            () => this.flush(),
            (err: unknown) => {
              this.log.warn(
                { err: describeError(err), pending: this.pending.length },
                'deferred short-straddle snapshot flush failed',
              );
            },
          )
        : null;
    this.warnIfOverThreshold();
  }

  async writeMany(rows: PersistedShortStraddleSnapshot[]): Promise<void> {
    if (rows.length === 0) return;
    appendJsonLines(this.cachePath, rows, encodeShortStraddleSnapshot);
    this.pending.push(...rows);
    this.warnIfOverThreshold();
  }

  async loadSince(
    query: ShortStraddleSnapshotLoadQuery,
  ): Promise<PersistedShortStraddleSnapshot[]> {
    let persisted: PersistedShortStraddleSnapshot[] = [];
    try {
      persisted = await this.delegate.loadSince(query);
    } catch (err: unknown) {
      this.log.warn({ err: String(err) }, 'short-straddle snapshot history load failed');
    }
    const underlying = query.underlying.toUpperCase();
    const combined = new Map<string, PersistedShortStraddleSnapshot>();
    for (const row of [...persisted, ...this.pending]) {
      if (row.underlying.toUpperCase() !== underlying || row.cohortSlotTs < query.since) continue;
      combined.set(shortStraddleSnapshotKey(row), row);
    }
    return [...combined.values()].sort(
      (a, b) =>
        a.cohortSlotTs.getTime() - b.cohortSlotTs.getTime() ||
        a.horizonHours - b.horizonHours ||
        a.venue.localeCompare(b.venue),
    );
  }

  async flush(): Promise<void> {
    if (this.flushPromise != null) return this.flushPromise;
    if (this.pending.length === 0) return;

    const batchSize = this.pending.length;
    const batch = this.pending.slice(0, batchSize);
    const flushPromise = this.flushBatch(batch, batchSize);
    this.flushPromise = flushPromise;
    try {
      await flushPromise;
    } finally {
      if (this.flushPromise === flushPromise) this.flushPromise = null;
    }
  }

  async dispose(): Promise<void> {
    this.timer?.dispose();
    try {
      if (this.flushPromise != null) await this.flushPromise;
    } finally {
      await this.delegate.dispose();
    }
  }

  private async flushBatch(
    batch: PersistedShortStraddleSnapshot[],
    batchSize: number,
  ): Promise<void> {
    await this.delegate.writeMany(batch);
    this.pending = this.pending.slice(batchSize);
    rewriteJsonLines(this.cachePath, this.pending, encodeShortStraddleSnapshot);
    if (this.pending.length <= this.maxPendingRows) this.warned = false;
  }

  private warnIfOverThreshold(): void {
    if (this.warned || this.pending.length <= this.maxPendingRows) return;
    this.warned = true;
    this.log.warn(
      { pending: this.pending.length, threshold: this.maxPendingRows },
      'short-straddle snapshot cache exceeds warning threshold',
    );
  }
}

function shortStraddleSnapshotKey(row: PersistedShortStraddleSnapshot): string {
  return `${row.venue}:${row.underlying.toUpperCase()}:${row.cohortSlotTs.getTime()}:${row.horizonHours}`;
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
  private readonly timer: FlushSchedule;

  constructor(
    private readonly delegate: RegimeStore,
    private readonly options: DeferredRegimePersistenceOptions,
    private readonly log: DeferredLog,
  ) {
    this.enabled = delegate.enabled;
    this.pendingObservationsPath = `${options.observationsCachePath}.pending`;
    this.pendingModelsPath = `${options.modelsCachePath}.pending`;
    this.observations = readJsonLines(options.observationsCachePath, decodeRegimeObservation, log);
    this.models = new Map(
      readJsonLines(options.modelsCachePath, decodeRegimeModel, log).map((model) => [
        model.underlying.toUpperCase(),
        model,
      ]),
    );
    this.pendingObservations = existsSync(this.pendingObservationsPath)
      ? readJsonLines(this.pendingObservationsPath, decodeRegimeObservation, log)
      : [...this.observations];
    this.pendingModels = existsSync(this.pendingModelsPath)
      ? new Map(
          readJsonLines(this.pendingModelsPath, decodeRegimeModel, log).map((model) => [
            model.underlying.toUpperCase(),
            model,
          ]),
        )
      : new Map(this.models);
    this.timer = new FlushSchedule(
      options.observationsCachePath,
      options.flushIntervalMs,
      () => this.flush(),
      (err: unknown) => {
        this.log.warn(
          {
            err: describeError(err),
            observations: this.pendingObservations.length,
            models: this.pendingModels.size,
          },
          'deferred regime flush failed',
        );
      },
    );
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

  async saveObservations(rows: PersistedRegimeObservation[]): Promise<void> {
    for (const row of rows) await this.saveObservation(row);
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
    if (this.flushing || (this.pendingObservations.length === 0 && this.pendingModels.size === 0)) {
      return;
    }
    this.flushing = true;
    const observations = [...this.pendingObservations];
    const models = new Map(this.pendingModels);
    try {
      for (const model of models.values()) await this.delegate.saveModel(model);
      await this.delegate.saveObservations(observations);
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
    this.timer.dispose();
    if (this.options.flushOnDispose === true) await this.flush();
    await this.delegate.dispose();
  }

  private rewritePending(): void {
    rewriteOutbox(this.pendingObservationsPath, this.pendingObservations, encodeRegimeObservation);
    rewriteOutbox(this.pendingModelsPath, [...this.pendingModels.values()], encodeRegimeModel);
  }
}
