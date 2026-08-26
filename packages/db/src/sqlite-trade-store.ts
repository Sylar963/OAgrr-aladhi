import { AsyncLocalStorage } from 'node:async_hooks';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { StringDecoder } from 'node:string_decoder';

import type {
  InstrumentListQuery,
  InstrumentSummary,
  MergeableTradeHistoryReader,
  RecentTradeQuery,
  TradeFilterQuery,
  TradeHistoryQuery,
  TradeHistorySummary,
  TradeRecordKey,
  TradeVenueSummary,
} from './trade-store.js';
import type { PersistedTradeLeg, PersistedTradeMode, PersistedTradeRecord } from './types.js';

interface SqliteTradeStoreOptions {
  readOnly?: boolean;
  busyTimeoutMs?: number;
}

interface LegacySerializedTradeRecord {
  tradeUid: string;
  mode: PersistedTradeMode;
  venue: string;
  underlying: string;
  instrumentName: string;
  tradeTs: string;
  ingestedAt: string;
  direction: 'buy' | 'sell';
  contracts: number;
  price: number | null;
  premiumUsd: number | null;
  notionalUsd: number | null;
  referencePriceUsd: number | null;
  expiry: string | null;
  strike: number | null;
  optionType: 'call' | 'put' | null;
  iv: number | null;
  markPrice: number | null;
  isBlock: boolean;
  strategyLabel: string | null;
  legs: PersistedTradeLeg[] | null;
  raw: Record<string, unknown>;
  queuedAt: number;
}

interface SqliteWhere {
  clauses: string[];
  values: SQLInputValue[];
}

type SqliteTradeLog = { warn: (obj: object, msg: string) => void };

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const LEGACY_IMPORT_BATCH_SIZE = 1_000;
const IO_CHUNK_BYTES = 64 * 1024;
const ALL_INSTRUMENTS_LIMIT = 2_147_483_647;

export class SqliteTradeStore implements MergeableTradeHistoryReader {
  private database: DatabaseSync | null = null;
  private readonly snapshotDatabase = new AsyncLocalStorage<DatabaseSync>();
  private readonly readOnly: boolean;
  private readonly busyTimeoutMs: number;

  constructor(
    readonly path: string,
    options: SqliteTradeStoreOptions = {},
  ) {
    this.readOnly = options.readOnly ?? false;
    this.busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (!Number.isInteger(this.busyTimeoutMs) || this.busyTimeoutMs < 0) {
      throw new Error('busyTimeoutMs must be a non-negative integer');
    }
    if (!this.readOnly) this.openDatabase();
  }

  get enabled(): boolean {
    return !this.readOnly || existsSync(this.path);
  }

  writeMany(records: PersistedTradeRecord[], queuedAt = Date.now()): number {
    if (records.length === 0) return 0;
    return this.writeEntries(records.map((record) => ({ record, queuedAt })));
  }

  private writeEntries(entries: { record: PersistedTradeRecord; queuedAt: number }[]): number {
    const database = this.requireWritableDatabase();
    const insert = database.prepare(INSERT_SQL);
    let inserted = 0;

    database.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of entries) {
        inserted += Number(insert.run(...recordValues(entry.record, entry.queuedAt)).changes);
      }
      database.exec('COMMIT');
      return inserted;
    } catch (error: unknown) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  async loadRecent(query: RecentTradeQuery): Promise<PersistedTradeRecord[]> {
    return this.selectRecords(query, query.limit);
  }

  async loadHistory(query: TradeHistoryQuery): Promise<PersistedTradeRecord[]> {
    const where = buildWhere(query);
    addCursor(where, query);
    return this.selectRecordsWithWhere(where, query.limit);
  }

  async loadByKeys(
    query: TradeFilterQuery,
    keys: TradeRecordKey[],
  ): Promise<PersistedTradeRecord[]> {
    if (keys.length === 0) return [];
    const database = this.getDatabase();
    if (database == null) return [];
    const where = buildWhere(query);
    const keySql = keys.map(() => '(?, ?)').join(', ');
    for (const key of keys) where.values.push(key.tradeUid, key.tradeTs.getTime());
    where.clauses.push(`(trade_uid, trade_ts) IN (${keySql})`);
    const rows = database.prepare(`${SELECT_SQL} ${whereSql(where)}`).all(...where.values);
    return rows.map(mapSqliteRecord);
  }

  async summarizeHistory(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
  ): Promise<TradeHistorySummary> {
    const database = this.getDatabase();
    if (database == null) return emptySummary();
    const where = buildWhere(query);
    const row = database
      .prepare(
        `SELECT
          COUNT(*) AS count,
          COALESCE(SUM(premium_usd), 0) AS premium_usd,
          COALESCE(SUM(notional_usd), 0) AS notional_usd,
          MIN(trade_ts) AS oldest_ts,
          MAX(trade_ts) AS newest_ts
        FROM pending_trades ${whereSql(where)}`,
      )
      .get(...where.values);
    const venueRows = database
      .prepare(
        `SELECT
          venue,
          COUNT(*) AS count,
          COALESCE(SUM(premium_usd), 0) AS premium_usd,
          COALESCE(SUM(notional_usd), 0) AS notional_usd
        FROM pending_trades ${whereSql(where)}
        GROUP BY venue
        ORDER BY count DESC, venue ASC`,
      )
      .all(...where.values);

    return {
      count: readNumber(row, 'count'),
      premiumUsd: readNumber(row, 'premium_usd'),
      notionalUsd: readNumber(row, 'notional_usd'),
      oldestTs: readNullableDate(row, 'oldest_ts'),
      newestTs: readNullableDate(row, 'newest_ts'),
      venues: venueRows.map(mapVenueSummary),
    };
  }

  async listInstruments(query: InstrumentListQuery): Promise<InstrumentSummary[]> {
    return this.selectInstrumentSummaries(query, undefined, query.limit);
  }

  async listAllInstruments(query: InstrumentListQuery): Promise<InstrumentSummary[]> {
    return this.selectInstrumentSummaries(query, undefined, ALL_INSTRUMENTS_LIMIT);
  }

  async listInstrumentsByNames(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
    instrumentNames: string[],
  ): Promise<InstrumentSummary[]> {
    if (instrumentNames.length === 0) return [];
    return this.selectInstrumentSummaries(query, instrumentNames, ALL_INSTRUMENTS_LIMIT);
  }

  async withReadSnapshot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.snapshotDatabase.getStore() != null || !existsSync(this.path)) return operation();
    const database = this.createDatabase(true);
    database.exec('BEGIN');
    try {
      const result = await this.snapshotDatabase.run(database, operation);
      database.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      database.close();
    }
  }

  loadPendingBatch(limit: number, queuedThrough: number): PersistedTradeRecord[] {
    const database = this.requireWritableDatabase();
    const rows = database
      .prepare(
        `${SELECT_SQL}
        WHERE queued_at <= ? AND upload_attempt = 0
        ORDER BY queued_at ASC, trade_ts ASC, trade_uid ASC
        LIMIT ?`,
      )
      .all(queuedThrough, limit);
    return rows.map(mapSqliteRecord);
  }

  markUploaded(records: PersistedTradeRecord[]): void {
    if (records.length === 0) return;
    const database = this.requireWritableDatabase();
    const mark = database.prepare(
      'UPDATE pending_trades SET upload_attempt = 1 WHERE trade_uid = ? AND trade_ts = ?',
    );
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) {
        mark.run(record.tradeUid, record.tradeTs.getTime());
      }
      database.exec('COMMIT');
    } catch (error: unknown) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  deleteUploaded(): number {
    const result = this.requireWritableDatabase()
      .prepare('DELETE FROM pending_trades WHERE upload_attempt = 1')
      .run();
    return Number(result.changes);
  }

  resetUploadAttempt(): void {
    this.requireWritableDatabase().exec(
      'UPDATE pending_trades SET upload_attempt = 0 WHERE upload_attempt != 0',
    );
  }

  countPending(): number {
    const row = this.requireWritableDatabase()
      .prepare('SELECT COUNT(*) AS count FROM pending_trades')
      .get();
    return readNumber(row, 'count');
  }

  oldestQueuedAt(): number | null {
    const row = this.requireWritableDatabase()
      .prepare('SELECT MIN(queued_at) AS queued_at FROM pending_trades')
      .get();
    return readNullableNumber(row, 'queued_at');
  }

  getRetryNotBefore(): number {
    return this.getMetadataNumber('retry_not_before') ?? 0;
  }

  setRetryNotBefore(value: number): void {
    this.setMetadataNumber('retry_not_before', value);
  }

  getRemoteMaxTradeTs(mode: PersistedTradeMode): number | null {
    return this.getMetadataNumber(`remote_max_trade_ts:${mode}`);
  }

  setRemoteMaxTradeTs(mode: PersistedTradeMode, value: number): void {
    this.setMetadataNumber(`remote_max_trade_ts:${mode}`, value);
  }

  clearRemoteMaxTradeTs(mode: PersistedTradeMode): void {
    this.requireWritableDatabase()
      .prepare('DELETE FROM trade_metadata WHERE key = ?')
      .run(`remote_max_trade_ts:${mode}`);
  }

  migrateLegacyFiles(paths: string[], log: SqliteTradeLog): void {
    for (const path of paths) {
      if (!existsSync(path)) continue;
      this.importLegacyFile(path);
      const migratedPath = nextMigratedPath(path);
      renameSync(path, migratedPath);
      log.warn({ source: path, migratedPath }, 'migrated legacy trade spool into SQLite');
    }
  }

  async dispose(): Promise<void> {
    if (this.database?.isOpen) this.database.close();
    this.database = null;
  }

  private selectRecords(query: TradeFilterQuery, limit: number): PersistedTradeRecord[] {
    return this.selectRecordsWithWhere(buildWhere(query), limit);
  }

  private selectRecordsWithWhere(where: SqliteWhere, limit: number): PersistedTradeRecord[] {
    const database = this.getDatabase();
    if (database == null) return [];
    const rows = database
      .prepare(
        `${SELECT_SQL} ${whereSql(where)}
        ORDER BY trade_ts DESC, trade_uid COLLATE BINARY DESC
        LIMIT ?`,
      )
      .all(...where.values, limit);
    return rows.map(mapSqliteRecord);
  }

  private selectInstrumentSummaries(
    query: TradeFilterQuery & { mode: PersistedTradeMode },
    instrumentNames: string[] | undefined,
    limit: number,
  ): InstrumentSummary[] {
    const database = this.getDatabase();
    if (database == null) return [];
    const where = buildWhere(query);
    if (instrumentNames != null) {
      where.clauses.push(`instrument_name IN (${instrumentNames.map(() => '?').join(', ')})`);
      where.values.push(...instrumentNames);
    }
    const rows = database
      .prepare(
        `WITH filtered AS (
          SELECT
            instrument_name,
            trade_ts,
            trade_uid,
            price,
            reference_price_usd,
            option_type,
            strike,
            expiry,
            ROW_NUMBER() OVER (
              PARTITION BY instrument_name
              ORDER BY trade_ts DESC, trade_uid COLLATE BINARY DESC
            ) AS row_number,
            COUNT(*) OVER (PARTITION BY instrument_name) AS trade_count
          FROM pending_trades
          ${whereSql(where)}
        )
        SELECT * FROM filtered
        WHERE row_number = 1
        ORDER BY trade_count DESC, trade_ts DESC, instrument_name COLLATE BINARY ASC
        LIMIT ?`,
      )
      .all(...where.values, limit);
    return rows.map(mapInstrumentSummary);
  }

  private importLegacyFile(path: string): void {
    const fallbackQueuedAt = Math.trunc(statSync(path).mtimeMs);
    let batch: LegacySerializedTradeRecord[] = [];
    for (const row of readLegacyJsonLines(path, fallbackQueuedAt)) {
      batch.push(row);
      if (batch.length === LEGACY_IMPORT_BATCH_SIZE) {
        this.writeLegacyBatch(batch);
        batch = [];
      }
    }
    if (batch.length > 0) this.writeLegacyBatch(batch);
  }

  private writeLegacyBatch(batch: LegacySerializedTradeRecord[]): void {
    this.writeEntries(
      batch.map((row) => ({ record: decodeLegacyRecord(row), queuedAt: row.queuedAt })),
    );
  }

  private getMetadataNumber(key: string): number | null {
    const database = this.getDatabase();
    if (database == null) return null;
    const row = database.prepare('SELECT value FROM trade_metadata WHERE key = ?').get(key);
    const value = readNullableString(row, 'value');
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private setMetadataNumber(key: string, value: number): void {
    this.requireWritableDatabase()
      .prepare(
        `INSERT INTO trade_metadata (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, String(value));
  }

  private getDatabase(): DatabaseSync | null {
    const snapshot = this.snapshotDatabase.getStore();
    if (snapshot != null) return snapshot;
    if (this.database != null) return this.database;
    if (this.readOnly && !existsSync(this.path)) return null;
    return this.openDatabase();
  }

  private requireWritableDatabase(): DatabaseSync {
    if (this.readOnly) throw new Error('SQLite trade store is read-only');
    return this.getDatabase() ?? this.openDatabase();
  }

  private openDatabase(): DatabaseSync {
    if (this.database != null) return this.database;
    if (!this.readOnly) mkdirSync(dirname(this.path), { recursive: true });
    const database = this.createDatabase(this.readOnly);
    this.database = database;
    return database;
  }

  private createDatabase(readOnly: boolean): DatabaseSync {
    const database = new DatabaseSync(this.path, { readOnly, timeout: this.busyTimeoutMs });
    database.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs}`);
    if (readOnly) {
      database.exec('PRAGMA query_only = ON');
    } else {
      database.exec('PRAGMA journal_mode = WAL');
      database.exec('PRAGMA synchronous = FULL');
      database.exec(SCHEMA_SQL);
    }
    return database;
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS pending_trades (
    trade_uid TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('live', 'institutional')),
    venue TEXT NOT NULL,
    underlying TEXT NOT NULL,
    instrument_name TEXT NOT NULL,
    trade_ts INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
    contracts REAL NOT NULL,
    price REAL,
    premium_usd REAL,
    notional_usd REAL,
    reference_price_usd REAL,
    expiry TEXT,
    strike REAL,
    option_type TEXT CHECK (option_type IN ('call', 'put') OR option_type IS NULL),
    iv REAL,
    mark_price REAL,
    is_block INTEGER NOT NULL CHECK (is_block IN (0, 1)),
    strategy_label TEXT,
    legs_json TEXT,
    raw_json TEXT NOT NULL,
    queued_at INTEGER NOT NULL,
    upload_attempt INTEGER NOT NULL DEFAULT 0 CHECK (upload_attempt IN (0, 1)),
    PRIMARY KEY (trade_uid, trade_ts)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS pending_trades_mode_ts
    ON pending_trades (mode, trade_ts DESC, trade_uid DESC);
  CREATE INDEX IF NOT EXISTS pending_trades_mode_underlying_ts
    ON pending_trades (mode, underlying, trade_ts DESC, trade_uid DESC);
  CREATE INDEX IF NOT EXISTS pending_trades_mode_venue_ts
    ON pending_trades (mode, venue, trade_ts DESC, trade_uid DESC);
  CREATE INDEX IF NOT EXISTS pending_trades_mode_underlying_venue_ts
    ON pending_trades (mode, underlying, venue, trade_ts DESC, trade_uid DESC);
  CREATE INDEX IF NOT EXISTS pending_trades_instrument_ts
    ON pending_trades (instrument_name, trade_ts DESC, trade_uid DESC);
  CREATE INDEX IF NOT EXISTS pending_trades_queued_at
    ON pending_trades (queued_at, trade_ts, trade_uid);
  CREATE TABLE IF NOT EXISTS trade_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
`;

const INSERT_SQL = `INSERT INTO pending_trades (
  trade_uid, mode, venue, underlying, instrument_name, trade_ts, ingested_at,
  direction, contracts, price, premium_usd, notional_usd, reference_price_usd,
  expiry, strike, option_type, iv, mark_price, is_block, strategy_label,
  legs_json, raw_json, queued_at
) VALUES (${Array.from({ length: 23 }, () => '?').join(', ')})
ON CONFLICT (trade_uid, trade_ts) DO NOTHING`;

const SELECT_SQL = `SELECT
  trade_uid, mode, venue, underlying, instrument_name, trade_ts, ingested_at,
  direction, contracts, price, premium_usd, notional_usd, reference_price_usd,
  expiry, strike, option_type, iv, mark_price, is_block, strategy_label,
  legs_json, raw_json
FROM pending_trades`;

function recordValues(record: PersistedTradeRecord, queuedAt: number): SQLInputValue[] {
  return [
    record.tradeUid,
    record.mode,
    record.venue,
    record.underlying,
    record.instrumentName,
    record.tradeTs.getTime(),
    record.ingestedAt.getTime(),
    record.direction,
    record.contracts,
    record.price,
    record.premiumUsd,
    record.notionalUsd,
    record.referencePriceUsd,
    record.expiry,
    record.strike,
    record.optionType,
    record.iv,
    record.markPrice,
    record.isBlock ? 1 : 0,
    record.strategyLabel,
    record.legs == null ? null : JSON.stringify(record.legs),
    JSON.stringify(record.raw),
    queuedAt,
  ];
}

function buildWhere(query: TradeFilterQuery): SqliteWhere {
  const where: SqliteWhere = { clauses: [], values: [] };
  if (query.mode) {
    where.clauses.push('mode = ?');
    where.values.push(query.mode);
  }
  if (query.underlying) {
    where.clauses.push('underlying = ?');
    where.values.push(query.underlying.toUpperCase());
  }
  if (query.venues && query.venues.length > 0) {
    where.clauses.push(`venue IN (${query.venues.map(() => '?').join(', ')})`);
    where.values.push(...query.venues);
  }
  if (query.instrumentName) {
    where.clauses.push('instrument_name = ?');
    where.values.push(query.instrumentName);
  }
  if (query.startTs) {
    where.clauses.push('trade_ts >= ?');
    where.values.push(query.startTs.getTime());
  }
  if (query.endTs) {
    where.clauses.push('trade_ts < ?');
    where.values.push(query.endTs.getTime());
  }
  return where;
}

function addCursor(where: SqliteWhere, query: TradeHistoryQuery): void {
  if (!query.beforeTs) return;
  if (query.beforeUid) {
    where.clauses.push('(trade_ts, trade_uid COLLATE BINARY) < (?, ?)');
    where.values.push(query.beforeTs.getTime(), query.beforeUid);
  } else {
    where.clauses.push('trade_ts < ?');
    where.values.push(query.beforeTs.getTime());
  }
}

function whereSql(where: SqliteWhere): string {
  return where.clauses.length === 0 ? '' : `WHERE ${where.clauses.join(' AND ')}`;
}

function mapSqliteRecord(row: Record<string, unknown>): PersistedTradeRecord {
  const raw = parseJson(readString(row, 'raw_json'));
  if (!isRecord(raw)) throw new Error('invalid raw_json in SQLite trade record');
  return {
    tradeUid: readString(row, 'trade_uid'),
    mode: readMode(row, 'mode'),
    venue: readString(row, 'venue'),
    underlying: readString(row, 'underlying'),
    instrumentName: readString(row, 'instrument_name'),
    tradeTs: new Date(readNumber(row, 'trade_ts')),
    ingestedAt: new Date(readNumber(row, 'ingested_at')),
    direction: readDirection(row, 'direction'),
    contracts: readNumber(row, 'contracts'),
    price: readNullableNumber(row, 'price'),
    premiumUsd: readNullableNumber(row, 'premium_usd'),
    notionalUsd: readNullableNumber(row, 'notional_usd'),
    referencePriceUsd: readNullableNumber(row, 'reference_price_usd'),
    expiry: readNullableString(row, 'expiry'),
    strike: readNullableNumber(row, 'strike'),
    optionType: readOptionType(row, 'option_type'),
    iv: readNullableNumber(row, 'iv'),
    markPrice: readNullableNumber(row, 'mark_price'),
    isBlock: readNumber(row, 'is_block') === 1,
    strategyLabel: readNullableString(row, 'strategy_label'),
    legs: parseLegs(readNullableString(row, 'legs_json')),
    raw,
  };
}

function mapVenueSummary(row: Record<string, unknown>): TradeVenueSummary {
  return {
    venue: readString(row, 'venue'),
    count: readNumber(row, 'count'),
    premiumUsd: readNumber(row, 'premium_usd'),
    notionalUsd: readNumber(row, 'notional_usd'),
  };
}

function mapInstrumentSummary(row: Record<string, unknown>): InstrumentSummary {
  return {
    instrument: readString(row, 'instrument_name'),
    count: readNumber(row, 'trade_count'),
    lastTs: new Date(readNumber(row, 'trade_ts')),
    lastTradeUid: readString(row, 'trade_uid'),
    lastPrice: readNullableNumber(row, 'price'),
    lastReferencePriceUsd: readNullableNumber(row, 'reference_price_usd'),
    optionType: readOptionType(row, 'option_type'),
    strike: readNullableNumber(row, 'strike'),
    expiry: readNullableString(row, 'expiry'),
  };
}

function readString(row: Record<string, unknown> | undefined, key: string): string {
  const value = row?.[key];
  if (typeof value !== 'string') throw new Error(`invalid SQLite string column: ${key}`);
  return value;
}

function readNullableString(row: Record<string, unknown> | undefined, key: string): string | null {
  const value = row?.[key];
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`invalid SQLite string column: ${key}`);
  return value;
}

function readNumber(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid SQLite number column: ${key}`);
  }
  return value;
}

function readNullableNumber(row: Record<string, unknown> | undefined, key: string): number | null {
  const value = row?.[key];
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid SQLite number column: ${key}`);
  }
  return value;
}

function readNullableDate(row: Record<string, unknown> | undefined, key: string): Date | null {
  const value = readNullableNumber(row, key);
  return value == null ? null : new Date(value);
}

function readMode(row: Record<string, unknown>, key: string): PersistedTradeMode {
  const value = readString(row, key);
  if (value !== 'live' && value !== 'institutional')
    throw new Error('invalid persisted trade mode');
  return value;
}

function readDirection(row: Record<string, unknown>, key: string): 'buy' | 'sell' {
  const value = readString(row, key);
  if (value !== 'buy' && value !== 'sell') throw new Error('invalid persisted trade direction');
  return value;
}

function readOptionType(row: Record<string, unknown>, key: string): 'call' | 'put' | null {
  const value = readNullableString(row, key);
  if (value !== null && value !== 'call' && value !== 'put') {
    throw new Error('invalid persisted option type');
  }
  return value;
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function parseLegs(value: string | null): PersistedTradeLeg[] | null {
  if (value == null) return null;
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || !parsed.every(isTradeLeg)) {
    throw new Error('invalid legs_json in SQLite trade record');
  }
  return parsed;
}

function isTradeLeg(value: unknown): value is PersistedTradeLeg {
  return (
    isRecord(value) &&
    typeof value['instrument'] === 'string' &&
    (value['direction'] === 'buy' || value['direction'] === 'sell') &&
    typeof value['price'] === 'number' &&
    typeof value['size'] === 'number' &&
    typeof value['ratio'] === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptySummary(): TradeHistorySummary {
  return { count: 0, premiumUsd: 0, notionalUsd: 0, oldestTs: null, newestTs: null, venues: [] };
}

function* readLegacyJsonLines(
  path: string,
  fallbackQueuedAt: number,
): Generator<LegacySerializedTradeRecord> {
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  const decoder = new StringDecoder('utf8');
  let remainder = '';
  try {
    let bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
      const body = remainder + decoder.write(buffer.subarray(0, bytesRead));
      const lines = body.split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() !== '') yield parseLegacyRecord(JSON.parse(line), fallbackQueuedAt);
      }
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    }
    const finalLine = remainder + decoder.end();
    if (finalLine.trim() !== '') yield parseLegacyRecord(JSON.parse(finalLine), fallbackQueuedAt);
  } finally {
    closeSync(descriptor);
  }
}

function parseLegacyRecord(value: unknown, fallbackQueuedAt: number): LegacySerializedTradeRecord {
  if (!isRecord(value)) throw new Error('invalid legacy trade spool row');
  const raw = value['raw'];
  const legs = value['legs'];
  const mode = value['mode'];
  const direction = value['direction'];
  const optionType = value['optionType'];
  if (!isRecord(raw)) throw new Error('invalid legacy trade raw payload');
  if (legs !== null && (!Array.isArray(legs) || !legs.every(isTradeLeg))) {
    throw new Error('invalid legacy trade legs payload');
  }
  if (mode !== 'live' && mode !== 'institutional') throw new Error('invalid legacy trade mode');
  if (direction !== 'buy' && direction !== 'sell')
    throw new Error('invalid legacy trade direction');
  if (optionType !== null && optionType !== 'call' && optionType !== 'put') {
    throw new Error('invalid legacy option type');
  }
  return {
    tradeUid: requiredString(value, 'tradeUid'),
    mode,
    venue: requiredString(value, 'venue'),
    underlying: requiredString(value, 'underlying'),
    instrumentName: requiredString(value, 'instrumentName'),
    tradeTs: requiredString(value, 'tradeTs'),
    ingestedAt: requiredString(value, 'ingestedAt'),
    direction,
    contracts: requiredNumber(value, 'contracts'),
    price: nullableNumber(value, 'price'),
    premiumUsd: nullableNumber(value, 'premiumUsd'),
    notionalUsd: nullableNumber(value, 'notionalUsd'),
    referencePriceUsd: nullableNumber(value, 'referencePriceUsd'),
    expiry: nullableString(value, 'expiry'),
    strike: nullableNumber(value, 'strike'),
    optionType,
    iv: nullableNumber(value, 'iv'),
    markPrice: nullableNumber(value, 'markPrice'),
    isBlock: requiredBoolean(value, 'isBlock'),
    strategyLabel: nullableString(value, 'strategyLabel'),
    legs,
    raw,
    queuedAt: optionalFiniteNumber(value, '_queuedAt') ?? fallbackQueuedAt,
  };
}

function decodeLegacyRecord(row: LegacySerializedTradeRecord): PersistedTradeRecord {
  return {
    ...row,
    tradeTs: parseDate(row.tradeTs, 'tradeTs'),
    ingestedAt: parseDate(row.ingestedAt, 'ingestedAt'),
  };
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`invalid legacy string field: ${key}`);
  return value;
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`invalid legacy string field: ${key}`);
  return value;
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = optionalFiniteNumber(row, key);
  if (value == null) throw new Error(`invalid legacy number field: ${key}`);
  return value;
}

function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  if (row[key] === null) return null;
  return requiredNumber(row, key);
}

function optionalFiniteNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') throw new Error(`invalid legacy boolean field: ${key}`);
  return value;
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`invalid legacy date field: ${field}`);
  return parsed;
}

function nextMigratedPath(path: string): string {
  const base = `${path}.migrated`;
  if (!existsSync(base)) return base;
  let suffix = 1;
  while (existsSync(`${base}.${suffix}`)) suffix += 1;
  return `${base}.${suffix}`;
}
