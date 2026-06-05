import { Pool } from 'pg';

const UPSERT_BATCH_SIZE = 200;

export interface PersistedDealerPosition {
  venue: string;
  underlying: string;
  instrumentName: string;
  expiry: string | null;
  strike: number;
  optionType: 'call' | 'put';
  dealerContracts: number;
  lastOi: number;
  lastSnapshotTs: Date;
}

export interface DealerBookStore {
  readonly enabled: boolean;
  loadAll(underlyings: string[]): Promise<PersistedDealerPosition[]>;
  upsertMany(positions: PersistedDealerPosition[]): Promise<void>;
  pruneExpired(beforeExpiry: string): Promise<number>;
  dispose(): Promise<void>;
}

export class NoopDealerBookStore implements DealerBookStore {
  readonly enabled = false;
  async loadAll(_underlyings: string[]): Promise<PersistedDealerPosition[]> {
    return [];
  }
  async upsertMany(_positions: PersistedDealerPosition[]): Promise<void> {}
  async pruneExpired(_beforeExpiry: string): Promise<number> {
    return 0;
  }
  async dispose(): Promise<void> {}
}

interface DealerBookRow {
  venue: string;
  underlying: string;
  instrument_name: string;
  expiry: string | null;
  strike: string | number;
  option_type: 'call' | 'put';
  dealer_contracts: string | number;
  last_oi: string | number;
  last_snapshot_ts: Date;
}

function mapRow(row: DealerBookRow): PersistedDealerPosition {
  return {
    venue: row.venue,
    underlying: row.underlying,
    instrumentName: row.instrument_name,
    expiry: row.expiry,
    strike: Number(row.strike),
    optionType: row.option_type,
    dealerContracts: Number(row.dealer_contracts),
    lastOi: Number(row.last_oi),
    lastSnapshotTs: row.last_snapshot_ts,
  };
}

export class PostgresDealerBookStore implements DealerBookStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresDealerBookStore {
    return new PostgresDealerBookStore(new Pool({ connectionString }));
  }

  async loadAll(underlyings: string[]): Promise<PersistedDealerPosition[]> {
    if (underlyings.length === 0) return [];
    const result = await this.pool.query<DealerBookRow>(
      `SELECT venue, underlying, instrument_name, expiry, strike, option_type,
              dealer_contracts, last_oi, last_snapshot_ts
       FROM dealer_book
       WHERE underlying = ANY($1::text[])`,
      [underlyings.map((u) => u.toUpperCase())],
    );
    return result.rows.map(mapRow);
  }

  async upsertMany(positions: PersistedDealerPosition[]): Promise<void> {
    if (positions.length === 0) return;
    for (let i = 0; i < positions.length; i += UPSERT_BATCH_SIZE) {
      const batch = positions.slice(i, i + UPSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((p, b) => {
        const o = b * 9;
        values.push(
          p.venue,
          p.underlying.toUpperCase(),
          p.instrumentName,
          p.expiry,
          p.strike,
          p.optionType,
          p.dealerContracts,
          p.lastOi,
          p.lastSnapshotTs,
        );
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9})`;
      });
      await this.pool.query(
        `INSERT INTO dealer_book (
          venue, underlying, instrument_name, expiry, strike, option_type,
          dealer_contracts, last_oi, last_snapshot_ts
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (venue, instrument_name) DO UPDATE SET
          dealer_contracts = EXCLUDED.dealer_contracts,
          last_oi = EXCLUDED.last_oi,
          last_snapshot_ts = EXCLUDED.last_snapshot_ts,
          updated_at = now()`,
        values,
      );
    }
  }

  async pruneExpired(beforeExpiry: string): Promise<number> {
    const result = await this.pool.query(
      'DELETE FROM dealer_book WHERE expiry IS NOT NULL AND expiry < $1',
      [beforeExpiry],
    );
    return result.rowCount ?? 0;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
