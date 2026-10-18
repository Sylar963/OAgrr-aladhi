import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '@oggregator/protocol';
import { ensurePrivateDir, restrictFile } from './fs-permissions.js';

const GENESIS_HASH = '0'.repeat(64);

export interface JournalEntry {
  seq: number;
  ts: number;
  actor: string;
  type: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

interface JournalRow {
  seq: number;
  ts: number;
  actor: string;
  type: string;
  payload: string;
  prev_hash: string;
  hash: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS journal (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  actor     TEXT NOT NULL,
  type      TEXT NOT NULL,
  payload   TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash      TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journal
  BEGIN SELECT RAISE(ABORT, 'journal is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal
  BEGIN SELECT RAISE(ABORT, 'journal is append-only'); END;
CREATE INDEX IF NOT EXISTS journal_actor_type ON journal (actor, type, seq);

CREATE TABLE IF NOT EXISTS idempotency (
  account_id TEXT NOT NULL,
  key        TEXT NOT NULL,
  response   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, key)
);
CREATE TRIGGER IF NOT EXISTS idempotency_no_update BEFORE UPDATE ON idempotency
  BEGIN SELECT RAISE(ABORT, 'idempotency results are immutable'); END;
`;

function rowHash(prevHash: string, row: Omit<JournalEntry, 'prevHash' | 'hash'>): string {
  return createHash('sha256')
    .update(prevHash)
    .update('|')
    .update(canonicalJson(row))
    .digest('hex');
}

/**
 * Authoritative local record of every command, decision and venue event. Synchronous writes:
 * an event isn't acknowledged until it's on disk, which a daily Neon flush can't give us.
 */
export class Journal {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(stateDir: string): Journal {
    ensurePrivateDir(stateDir);
    const path = join(stateDir, 'journal.sqlite');
    const db = new DatabaseSync(path);
    restrictFile(path);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = FULL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA);
    return new Journal(db);
  }

  /** In-memory journal for tests. */
  static memory(): Journal {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    return new Journal(db);
  }

  append(actor: string, type: string, payload: unknown, ts: number = Date.now()): JournalEntry {
    // IMMEDIATE takes the write lock up front so the CLI and the daemon can't fork the chain.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const last = this.db
        .prepare('SELECT seq, hash FROM journal ORDER BY seq DESC LIMIT 1')
        .get() as { seq: number; hash: string } | undefined;
      const prevHash = last?.hash ?? GENESIS_HASH;
      const seq = (last?.seq ?? 0) + 1;
      const hash = rowHash(prevHash, { seq, ts, actor, type, payload });
      this.db
        .prepare(
          'INSERT INTO journal (seq, ts, actor, type, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(seq, ts, actor, type, canonicalJson(payload), prevHash, hash);
      this.db.exec('COMMIT');
      return { seq, ts, actor, type, payload, prevHash, hash };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  lastSeq(): number {
    const row = this.db.prepare('SELECT MAX(seq) AS seq FROM journal').get() as {
      seq: number | null;
    };
    return row.seq ?? 0;
  }

  /** Most recent entry of any of the given types, oldest-first scan avoided. */
  lastOfType(types: readonly string[]): JournalEntry | null {
    const placeholders = types.map(() => '?').join(',');
    const row = this.db
      .prepare(`SELECT * FROM journal WHERE type IN (${placeholders}) ORDER BY seq DESC LIMIT 1`)
      .get(...types) as JournalRow | undefined;
    return row ? toEntry(row) : null;
  }

  /** Most recent entry of the given types written by any of the given actors. */
  lastOfTypeFor(types: readonly string[], actors: readonly string[]): JournalEntry | null {
    const typeSlots = types.map(() => '?').join(',');
    const actorSlots = actors.map(() => '?').join(',');
    const row = this.db
      .prepare(
        `SELECT * FROM journal WHERE type IN (${typeSlots}) AND actor IN (${actorSlots})
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(...types, ...actors) as JournalRow | undefined;
    return row ? toEntry(row) : null;
  }

  /** Recomputes every hash. Returns the first broken seq, or null when the chain is intact. */
  verifyChain(): number | null {
    let prevHash = GENESIS_HASH;
    let expectedSeq = 1;
    for (const raw of this.db.prepare('SELECT * FROM journal ORDER BY seq').iterate()) {
      const row = raw as unknown as JournalRow;
      const entry = toEntry(row);
      const recomputed = rowHash(prevHash, {
        seq: entry.seq,
        ts: entry.ts,
        actor: entry.actor,
        type: entry.type,
        payload: entry.payload,
      });
      if (row.seq !== expectedSeq || row.prev_hash !== prevHash || row.hash !== recomputed) {
        return row.seq;
      }
      prevHash = row.hash;
      expectedSeq += 1;
    }
    return null;
  }

  getIdempotentResponse(accountId: string, key: string): string | null {
    const row = this.db
      .prepare('SELECT response FROM idempotency WHERE account_id = ? AND key = ?')
      .get(accountId, key) as { response: string } | undefined;
    return row?.response ?? null;
  }

  saveIdempotentResponse(accountId: string, key: string, response: string, ts = Date.now()): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO idempotency (account_id, key, response, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(accountId, key, response, ts);
  }

  /** Test hook: raw SQL, used to prove the triggers and the hash chain catch tampering. */
  unsafeExecForTests(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

function toEntry(row: JournalRow): JournalEntry {
  return {
    seq: row.seq,
    ts: row.ts,
    actor: row.actor,
    type: row.type,
    payload: JSON.parse(row.payload) as unknown,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}
