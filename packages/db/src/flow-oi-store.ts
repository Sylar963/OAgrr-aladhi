import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { FlowOiTickSchema, type FlowOiTick } from '@oggregator/protocol';
import { FlushSchedule, type DeferredLog } from './deferred-persistence.js';
import { createPgPool } from './pg-pool.js';

interface Options {
  connectionString?: string | undefined;
  pool?: Pool;
  flushIntervalMs?: number;
  log?: DeferredLog;
}

export class FlowOiStore {
  private readonly db: DatabaseSync;
  private readonly pool: Pool | null;
  private readonly schedule: FlushSchedule | null;
  private flushing: Promise<void> | null = null;

  constructor(path: string, options: Options = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS flow_oi (
        venue TEXT NOT NULL, instrument TEXT NOT NULL, underlying TEXT NOT NULL,
        timestamp INTEGER NOT NULL, observed_at INTEGER NOT NULL, open_interest REAL NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (venue, instrument, timestamp)
      );
      CREATE INDEX IF NOT EXISTS flow_oi_retention ON flow_oi(timestamp);
      CREATE TABLE IF NOT EXISTS flow_oi_upload (
        slot INTEGER PRIMARY KEY CHECK (slot = 1), id TEXT NOT NULL, last_rowid INTEGER NOT NULL,
        start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL, tick_count INTEGER NOT NULL, payload BLOB NOT NULL
      );
    `);
    if (
      !this.db
        .prepare('PRAGMA table_info(flow_oi)')
        .all()
        .some((column) => column['name'] === 'archived')
    )
      this.db.exec('ALTER TABLE flow_oi ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
    this.db.exec('CREATE INDEX IF NOT EXISTS flow_oi_pending ON flow_oi(archived)');
    this.pool =
      options.pool ??
      (options.connectionString
        ? createPgPool({
            connectionString: options.connectionString,
            idleTimeoutMillis: 1_000,
            connectionTimeoutMillis: 10_000,
          })
        : null);
    const onError = (err: unknown) =>
      options.log?.warn(
        { err: String(err) },
        'flow OI archive failed; retaining local outbox until next daily attempt',
      );
    this.schedule = this.pool
      ? new FlushSchedule(
          path,
          Math.max(86_400_000, options.flushIntervalMs ?? 86_400_000),
          // Failed attempts also wait a full day, so retry traffic cannot keep Neon awake.
          async () => {
            writeFileSync(`${path}.last-flush`, `${Date.now()}\n`);
            await this.flush().catch(onError);
          },
          onError,
        )
      : null;
  }

  append(input: FlowOiTick): void {
    const tick = FlowOiTickSchema.parse(input);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO flow_oi (venue, instrument, underlying, timestamp, observed_at, open_interest) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tick.venue,
        tick.instrument,
        tick.underlying,
        tick.timestamp,
        tick.observedAt,
        tick.openInterest,
      );
  }

  bracket(
    venue: string,
    instrument: string,
    timestamp: number,
  ): { before: FlowOiTick | null; after: FlowOiTick | null } {
    const columns =
      'venue, instrument, underlying, timestamp, observed_at AS observedAt, open_interest AS openInterest';
    const before = this.db
      .prepare(
        `SELECT ${columns} FROM flow_oi WHERE venue = ? AND instrument = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1`,
      )
      .get(venue, instrument, timestamp);
    const after = this.db
      .prepare(
        `SELECT ${columns} FROM flow_oi WHERE venue = ? AND instrument = ? AND timestamp > ? ORDER BY timestamp LIMIT 1`,
      )
      .get(venue, instrument, timestamp);
    return {
      before: before ? FlowOiTickSchema.parse(before) : null,
      after: after ? FlowOiTickSchema.parse(after) : null,
    };
  }

  prune(before: number): void {
    this.db
      .prepare('DELETE FROM flow_oi WHERE timestamp < ? AND (archived = 1 OR ? = 0)')
      .run(before, this.pool ? 1 : 0);
  }

  flush(): Promise<void> {
    this.flushing ??= this.sync().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async dispose(): Promise<void> {
    this.schedule?.dispose();
    try {
      await this.flushing;
    } finally {
      this.db.close();
      await this.pool?.end();
    }
  }

  private async sync(): Promise<void> {
    if (!this.pool) return;
    const highWater = this.db.prepare('SELECT MAX(rowid) AS id FROM flow_oi').get()?.['id'];
    if (typeof highWater !== 'number') return;
    while (true) {
      let batch = this.db.prepare('SELECT * FROM flow_oi_upload WHERE slot = 1').get();
      if (!batch) {
        const rows = this.db
        .prepare(`SELECT rowid AS id, venue, instrument, underlying, timestamp,
        observed_at AS observedAt, open_interest AS openInterest FROM flow_oi
        WHERE archived = 0 AND rowid <= ? ORDER BY rowid LIMIT 5000`)
        .all(highWater);
        if (rows.length === 0) break;
        const ticks = rows.map((row) => FlowOiTickSchema.parse(row));
        const payload = gzipSync(Buffer.from(JSON.stringify(ticks)));
        const id = createHash('sha256').update(payload).digest('hex');
        this.db.prepare('INSERT INTO flow_oi_upload VALUES (1, ?, ?, ?, ?, ?, ?)').run(
          id, rows.at(-1)!['id']!, Math.min(...ticks.map((tick) => tick.timestamp)),
          Math.max(...ticks.map((tick) => tick.timestamp)), ticks.length, payload,
        );
        batch = this.db.prepare('SELECT * FROM flow_oi_upload WHERE slot = 1').get()!;
      }
      await this.pool.query(
        `INSERT INTO flow_oi_archives (id, start_ts, end_ts, tick_count, payload)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [
          batch['id'], new Date(Number(batch['start_ts'])), new Date(Number(batch['end_ts'])),
          batch['tick_count'], batch['payload'],
        ],
      );
      this.db.exec('BEGIN');
      try {
        this.db.prepare('UPDATE flow_oi SET archived = 1 WHERE archived = 0 AND rowid <= ?').run(batch['last_rowid']!);
        this.db.exec('DELETE FROM flow_oi_upload WHERE slot = 1; COMMIT;');
      } catch (error: unknown) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }
}
