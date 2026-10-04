import { Pool } from 'pg';

const INSERT_BATCH_SIZE = 500;
const COLUMNS_PER_ROW = 6;

export interface PersistedGexWallSnapshot {
  underlying: string;
  slotTs: Date;
  spot: number | null;
  callWall: number | null;
  putWall: number | null;
  gammaFlip: number | null;
}

export interface GexWallSnapshotStore {
  readonly enabled: boolean;
  writeMany(rows: PersistedGexWallSnapshot[]): Promise<void>;
  loadSince(since: Date): Promise<PersistedGexWallSnapshot[]>;
  prune(before: Date): Promise<number>;
  dispose(): Promise<void>;
}

export class NoopGexWallSnapshotStore implements GexWallSnapshotStore {
  readonly enabled = false;
  async writeMany(): Promise<void> {}
  async loadSince(): Promise<PersistedGexWallSnapshot[]> {
    return [];
  }
  async prune(): Promise<number> {
    return 0;
  }
  async dispose(): Promise<void> {}
}

export class PostgresGexWallSnapshotStore implements GexWallSnapshotStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresGexWallSnapshotStore {
    return new PostgresGexWallSnapshotStore(new Pool({ connectionString }));
  }

  async writeMany(rows: PersistedGexWallSnapshot[]): Promise<void> {
    for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((row, batchIndex) => {
        const offset = batchIndex * COLUMNS_PER_ROW;
        values.push(
          row.underlying.toUpperCase(),
          row.slotTs,
          row.spot,
          row.callWall,
          row.putWall,
          row.gammaFlip,
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
      });
      await this.pool.query(
        `INSERT INTO gex_wall_snapshots (underlying, slot_ts, spot, call_wall, put_wall, gamma_flip)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (underlying, slot_ts) DO NOTHING`,
        values,
      );
    }
  }

  async loadSince(since: Date): Promise<PersistedGexWallSnapshot[]> {
    const result = await this.pool.query<GexWallSnapshotRow>(
      `SELECT underlying, slot_ts, spot, call_wall, put_wall, gamma_flip
       FROM gex_wall_snapshots
       WHERE slot_ts >= $1
       ORDER BY underlying ASC, slot_ts ASC`,
      [since],
    );
    return result.rows.map(mapRow);
  }

  async prune(before: Date): Promise<number> {
    const result = await this.pool.query('DELETE FROM gex_wall_snapshots WHERE slot_ts < $1', [
      before,
    ]);
    return result.rowCount ?? 0;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface GexWallSnapshotRow {
  underlying: string;
  slot_ts: Date;
  spot: number | null;
  call_wall: number | null;
  put_wall: number | null;
  gamma_flip: number | null;
}

function mapRow(row: GexWallSnapshotRow): PersistedGexWallSnapshot {
  return {
    underlying: row.underlying,
    slotTs: row.slot_ts,
    spot: row.spot,
    callWall: row.call_wall,
    putWall: row.put_wall,
    gammaFlip: row.gamma_flip,
  };
}
