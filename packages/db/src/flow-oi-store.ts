import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { FlowOiTickSchema, type FlowOiTick } from '@oggregator/protocol';

export class FlowOiStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS flow_oi (
        venue TEXT NOT NULL, instrument TEXT NOT NULL, underlying TEXT NOT NULL,
        timestamp INTEGER NOT NULL, observed_at INTEGER NOT NULL, open_interest REAL NOT NULL,
        PRIMARY KEY (venue, instrument, timestamp)
      );
      CREATE INDEX IF NOT EXISTS flow_oi_retention ON flow_oi(timestamp);
    `);
  }

  append(input: FlowOiTick): void {
    const tick = FlowOiTickSchema.parse(input);
    this.db.prepare(`INSERT OR IGNORE INTO flow_oi VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tick.venue, tick.instrument, tick.underlying, tick.timestamp, tick.observedAt, tick.openInterest);
  }

  bracket(venue: string, instrument: string, timestamp: number): { before: FlowOiTick | null; after: FlowOiTick | null } {
    const columns = 'venue, instrument, underlying, timestamp, observed_at AS observedAt, open_interest AS openInterest';
    const before = this.db.prepare(`SELECT ${columns} FROM flow_oi WHERE venue = ? AND instrument = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT 1`)
      .get(venue, instrument, timestamp);
    const after = this.db.prepare(`SELECT ${columns} FROM flow_oi WHERE venue = ? AND instrument = ? AND timestamp > ? ORDER BY timestamp LIMIT 1`)
      .get(venue, instrument, timestamp);
    return { before: before ? FlowOiTickSchema.parse(before) : null, after: after ? FlowOiTickSchema.parse(after) : null };
  }

  prune(before: number): void {
    this.db.prepare('DELETE FROM flow_oi WHERE timestamp < ?').run(before);
  }

  dispose(): void { this.db.close(); }
}
