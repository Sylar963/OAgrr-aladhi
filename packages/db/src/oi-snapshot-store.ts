import { Pool } from 'pg';

const INSERT_BATCH_SIZE = 200;

export interface PersistedOiSnapshot {
  venue: string;
  underlying: string;
  instrumentName: string;
  expiry: string | null;
  strike: number;
  optionType: 'call' | 'put';
  openInterest: number;
  snapshotTs: Date;
}

export interface OiSnapshotStore {
  readonly enabled: boolean;
  writeMany(rows: PersistedOiSnapshot[]): Promise<void>;
  prune(before: Date): Promise<number>;
  dispose(): Promise<void>;
}

export class NoopOiSnapshotStore implements OiSnapshotStore {
  readonly enabled = false;
  async writeMany(_rows: PersistedOiSnapshot[]): Promise<void> {}
  async prune(_before: Date): Promise<number> {
    return 0;
  }
  async dispose(): Promise<void> {}
}

export class PostgresOiSnapshotStore implements OiSnapshotStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresOiSnapshotStore {
    return new PostgresOiSnapshotStore(new Pool({ connectionString }));
  }

  async writeMany(rows: PersistedOiSnapshot[]): Promise<void> {
    if (rows.length === 0) return;
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((r, b) => {
        const o = b * 8;
        values.push(
          r.venue,
          r.underlying.toUpperCase(),
          r.instrumentName,
          r.expiry,
          r.strike,
          r.optionType,
          r.openInterest,
          r.snapshotTs,
        );
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`;
      });
      await this.pool.query(
        `INSERT INTO oi_snapshots (
          venue, underlying, instrument_name, expiry, strike, option_type, open_interest, snapshot_ts
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (venue, instrument_name, snapshot_ts) DO NOTHING`,
        values,
      );
    }
  }

  async prune(before: Date): Promise<number> {
    const result = await this.pool.query('DELETE FROM oi_snapshots WHERE snapshot_ts < $1', [
      before,
    ]);
    return result.rowCount ?? 0;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
