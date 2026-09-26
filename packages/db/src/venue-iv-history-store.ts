import { Pool } from 'pg';

const INSERT_BATCH_SIZE = 500;

export interface PersistedVenueIvHistoryPoint {
  venue: string;
  underlying: string;
  tenorDays: 7 | 30 | 60 | 90;
  slotTs: Date;
  observedAt: Date;
  atmIv: number;
  rr25d: number | null;
  bfly25d: number | null;
}

export interface VenueIvHistoryLoadQuery {
  underlying: string;
  tenorDays: PersistedVenueIvHistoryPoint['tenorDays'][];
  since: Date;
}

export interface VenueIvHistoryStore {
  readonly enabled: boolean;
  writeMany(points: PersistedVenueIvHistoryPoint[]): Promise<void>;
  loadSince(query: VenueIvHistoryLoadQuery): Promise<PersistedVenueIvHistoryPoint[]>;
  dispose(): Promise<void>;
}

export class NoopVenueIvHistoryStore implements VenueIvHistoryStore {
  readonly enabled = false;

  async writeMany(_points: PersistedVenueIvHistoryPoint[]): Promise<void> {}

  async loadSince(_query: VenueIvHistoryLoadQuery): Promise<PersistedVenueIvHistoryPoint[]> {
    return [];
  }

  async dispose(): Promise<void> {}
}

export class PostgresVenueIvHistoryStore implements VenueIvHistoryStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresVenueIvHistoryStore {
    return new PostgresVenueIvHistoryStore(new Pool({ connectionString }));
  }

  async writeMany(points: PersistedVenueIvHistoryPoint[]): Promise<void> {
    for (let index = 0; index < points.length; index += INSERT_BATCH_SIZE) {
      const batch = points.slice(index, index + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((point, batchIndex) => {
        const offset = batchIndex * 8;
        values.push(
          point.venue,
          point.underlying.toUpperCase(),
          point.tenorDays,
          point.slotTs,
          point.observedAt,
          point.atmIv,
          point.rr25d,
          point.bfly25d,
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
      });
      await this.pool.query(
        `INSERT INTO venue_iv_history_points (
          venue,
          underlying,
          tenor_days,
          slot_ts,
          observed_at,
          atm_iv,
          rr25d,
          bfly25d
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (underlying, venue, tenor_days, slot_ts) DO UPDATE SET
          observed_at = EXCLUDED.observed_at,
          atm_iv = EXCLUDED.atm_iv,
          rr25d = EXCLUDED.rr25d,
          bfly25d = EXCLUDED.bfly25d`,
        values,
      );
    }
  }

  async loadSince(query: VenueIvHistoryLoadQuery): Promise<PersistedVenueIvHistoryPoint[]> {
    if (query.tenorDays.length === 0) return [];
    const result = await this.pool.query<VenueIvHistoryRow>(
      `SELECT venue, underlying, tenor_days, slot_ts, observed_at, atm_iv, rr25d, bfly25d
      FROM venue_iv_history_points
      WHERE underlying = $1
        AND tenor_days = ANY($2::smallint[])
        AND slot_ts >= $3
      ORDER BY venue ASC, tenor_days ASC, slot_ts ASC`,
      [query.underlying.toUpperCase(), query.tenorDays, query.since],
    );
    return result.rows.map(mapRow);
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface VenueIvHistoryRow {
  venue: string;
  underlying: string;
  tenor_days: number;
  slot_ts: Date;
  observed_at: Date;
  atm_iv: number | string;
  rr25d: number | string | null;
  bfly25d: number | string | null;
}

function toNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: VenueIvHistoryRow): PersistedVenueIvHistoryPoint {
  return {
    venue: row.venue,
    underlying: row.underlying,
    tenorDays: row.tenor_days as PersistedVenueIvHistoryPoint['tenorDays'],
    slotTs: row.slot_ts,
    observedAt: row.observed_at,
    atmIv: toNumber(row.atm_iv) ?? Number.NaN,
    rr25d: toNumber(row.rr25d),
    bfly25d: toNumber(row.bfly25d),
  };
}
