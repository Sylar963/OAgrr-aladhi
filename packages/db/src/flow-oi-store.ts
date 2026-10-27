import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
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
          () => this.flush().catch(onError),
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
      const rows = this.db
        .prepare(`SELECT rowid AS id, venue, instrument, underlying, timestamp,
        observed_at AS observedAt, open_interest AS openInterest FROM flow_oi
        WHERE archived = 0 AND rowid <= ? ORDER BY rowid LIMIT 5000`)
        .all(highWater);
      if (rows.length === 0) break;
      const ticks = rows.map((row) => FlowOiTickSchema.parse(row));
      const payload = gzipSync(Buffer.from(JSON.stringify(ticks)));
      const id = createHash('sha256').update(payload).digest('hex');
      await this.pool.query(
        `INSERT INTO flow_oi_archives (id, start_ts, end_ts, tick_count, payload)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [
          id,
          new Date(Math.min(...ticks.map((tick) => tick.timestamp))),
          new Date(Math.max(...ticks.map((tick) => tick.timestamp))),
          ticks.length,
          payload,
        ],
      );
      this.db
        .prepare('UPDATE flow_oi SET archived = 1 WHERE archived = 0 AND rowid <= ?')
        .run(rows.at(-1)!['id']!);
    }
  }
}
