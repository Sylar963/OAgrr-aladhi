import { Pool } from 'pg';

const INSERT_BATCH_SIZE = 200;
const COLUMNS_PER_ROW = 8;

export interface PersistedBreakEvenSnapshot {
  underlying: string;
  expiry: string;
  expiryTs: Date;
  slotTs: Date;
  spot: number;
  forward: number;
  strikes: number[];
  markIvs: number[];
}

export interface BreakEvenSnapshotStore {
  readonly enabled: boolean;
  writeMany(rows: PersistedBreakEvenSnapshot[]): Promise<void>;
  /** Rows whose expiry is at or after `expiringAfter`. */
  loadActive(expiringAfter: Date): Promise<PersistedBreakEvenSnapshot[]>;
  /** Deletes rows whose expiry is before `expiredBefore`. */
  prune(expiredBefore: Date): Promise<number>;
  dispose(): Promise<void>;
}

export class NoopBreakEvenSnapshotStore implements BreakEvenSnapshotStore {
  readonly enabled = false;
  async writeMany(): Promise<void> {}
  async loadActive(): Promise<PersistedBreakEvenSnapshot[]> {
    return [];
  }
  async prune(): Promise<number> {
    return 0;
  }
  async dispose(): Promise<void> {}
}

export class PostgresBreakEvenSnapshotStore implements BreakEvenSnapshotStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresBreakEvenSnapshotStore {
    return new PostgresBreakEvenSnapshotStore(new Pool({ connectionString }));
  }

  async writeMany(rows: PersistedBreakEvenSnapshot[]): Promise<void> {
    for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((row, batchIndex) => {
        const offset = batchIndex * COLUMNS_PER_ROW;
        values.push(
          row.underlying.toUpperCase(),
          row.expiry,
          row.slotTs,
          row.expiryTs,
          row.spot,
          row.forward,
          row.strikes,
          row.markIvs,
        );
        const slots = Array.from({ length: COLUMNS_PER_ROW }, (_, i) => `$${offset + i + 1}`);
        return `(${slots.join(', ')})`;
      });
      await this.pool.query(
        `INSERT INTO break_even_snapshots
           (underlying, expiry, slot_ts, expiry_ts, spot, forward, strikes, mark_ivs)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (underlying, expiry, slot_ts) DO NOTHING`,
        values,
      );
    }
  }

  async loadActive(expiringAfter: Date): Promise<PersistedBreakEvenSnapshot[]> {
    const result = await this.pool.query<BreakEvenSnapshotRow>(
      `SELECT underlying, expiry, slot_ts, expiry_ts, spot, forward, strikes, mark_ivs
       FROM break_even_snapshots
       WHERE expiry_ts >= $1
       ORDER BY underlying ASC, expiry ASC, slot_ts ASC`,
      [expiringAfter],
    );
    return result.rows.map(mapRow);
  }

  async prune(expiredBefore: Date): Promise<number> {
    const result = await this.pool.query('DELETE FROM break_even_snapshots WHERE expiry_ts < $1', [
      expiredBefore,
    ]);
    return result.rowCount ?? 0;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface BreakEvenSnapshotRow {
  underlying: string;
  expiry: string;
  slot_ts: Date;
  expiry_ts: Date;
  spot: number;
  forward: number;
  strikes: number[];
  mark_ivs: number[];
}

function mapRow(row: BreakEvenSnapshotRow): PersistedBreakEvenSnapshot {
  return {
    underlying: row.underlying,
    expiry: row.expiry,
    expiryTs: row.expiry_ts,
    slotTs: row.slot_ts,
    spot: row.spot,
    forward: row.forward,
    strikes: row.strikes,
    markIvs: row.mark_ivs,
  };
}
