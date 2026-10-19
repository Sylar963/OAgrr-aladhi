import type { Pool } from 'pg';
import { createPgPool } from './pg-pool.js';

/** The record column holds the protocol `ThesisRecord`; the server validates it on load. */
export interface PersistedThesis {
  id: string;
  accountId: string;
  underlying: string;
  state: string;
  createdAt: Date;
  endedAt: Date | null;
  record: unknown;
}

export interface PersistedThesisEvent {
  id: string;
  thesisId: string;
  accountId: string;
  kind: string;
  payload: unknown;
  createdAt: Date;
}

export interface ThesisLoadQuery {
  /** Theses still active, or ended at or after this time, are loaded with their events. */
  endedSince: Date;
}

export interface ThesisStore {
  readonly enabled: boolean;
  load(query: ThesisLoadQuery): Promise<{ theses: PersistedThesis[]; events: PersistedThesisEvent[] }>;
  /** One transaction: theses upserted (latest wins), events inserted once. */
  save(
    theses: PersistedThesis[],
    events: PersistedThesisEvent[],
  ): Promise<{ theses: number; events: number }>;
  dispose(): Promise<void>;
}

export class NoopThesisStore implements ThesisStore {
  readonly enabled = false;
  async load(): Promise<{ theses: PersistedThesis[]; events: PersistedThesisEvent[] }> {
    return { theses: [], events: [] };
  }
  async save(): Promise<{ theses: number; events: number }> {
    return { theses: 0, events: 0 };
  }
  async dispose(): Promise<void> {}
}

interface ThesisRow {
  id: string;
  account_id: string;
  underlying: string;
  state: string;
  created_at: Date;
  ended_at: Date | null;
  record: unknown;
}

interface ThesisEventRow {
  id: string;
  thesis_id: string;
  account_id: string;
  kind: string;
  payload: unknown;
  created_at: Date;
}

export class PostgresThesisStore implements ThesisStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresThesisStore {
    return new PostgresThesisStore(createPgPool({ connectionString }));
  }

  async load(
    query: ThesisLoadQuery,
  ): Promise<{ theses: PersistedThesis[]; events: PersistedThesisEvent[] }> {
    const theses = await this.pool.query<ThesisRow>(
      `SELECT id, account_id, underlying, state, created_at, ended_at, record
       FROM theses
       WHERE ended_at IS NULL OR ended_at >= $1
       ORDER BY created_at ASC`,
      [query.endedSince],
    );
    const ids = theses.rows.map((row) => row.id);
    const events =
      ids.length === 0
        ? { rows: [] as ThesisEventRow[] }
        : await this.pool.query<ThesisEventRow>(
            `SELECT id, thesis_id, account_id, kind, payload, created_at
             FROM thesis_events
             WHERE thesis_id = ANY($1::uuid[])
             ORDER BY created_at ASC`,
            [ids],
          );
    return {
      theses: theses.rows.map((row) => ({
        id: row.id,
        accountId: row.account_id,
        underlying: row.underlying,
        state: row.state,
        createdAt: row.created_at,
        endedAt: row.ended_at,
        record: row.record,
      })),
      events: events.rows.map((row) => ({
        id: row.id,
        thesisId: row.thesis_id,
        accountId: row.account_id,
        kind: row.kind,
        payload: row.payload,
        createdAt: row.created_at,
      })),
    };
  }

  async save(
    theses: PersistedThesis[],
    events: PersistedThesisEvent[],
  ): Promise<{ theses: number; events: number }> {
    if (theses.length === 0 && events.length === 0) return { theses: 0, events: 0 };
    // ON CONFLICT DO UPDATE rejects a batch that touches the same id twice.
    const latest = [...new Map(theses.map((thesis) => [thesis.id, thesis])).values()];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let thesisCount = 0;
      if (latest.length > 0) {
        const result = await client.query(
          `INSERT INTO theses (id, account_id, underlying, state, created_at, ended_at, record, updated_at)
           SELECT * , now() FROM UNNEST(
             $1::uuid[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::timestamptz[], $7::jsonb[]
           )
           ON CONFLICT (id) DO UPDATE SET
             state = EXCLUDED.state,
             ended_at = EXCLUDED.ended_at,
             record = EXCLUDED.record,
             updated_at = now()`,
          [
            latest.map((t) => t.id),
            latest.map((t) => t.accountId),
            latest.map((t) => t.underlying),
            latest.map((t) => t.state),
            latest.map((t) => t.createdAt),
            latest.map((t) => t.endedAt),
            latest.map((t) => JSON.stringify(t.record)),
          ],
        );
        thesisCount = result.rowCount ?? 0;
      }
      let eventCount = 0;
      if (events.length > 0) {
        const result = await client.query(
          `INSERT INTO thesis_events (id, thesis_id, account_id, kind, payload, created_at)
           SELECT * FROM UNNEST(
             $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::jsonb[], $6::timestamptz[]
           )
           ON CONFLICT (id) DO NOTHING`,
          [
            events.map((e) => e.id),
            events.map((e) => e.thesisId),
            events.map((e) => e.accountId),
            events.map((e) => e.kind),
            events.map((e) => JSON.stringify(e.payload)),
            events.map((e) => e.createdAt),
          ],
        );
        eventCount = result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      return { theses: thesisCount, events: eventCount };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
