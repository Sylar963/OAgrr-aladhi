import { Pool } from 'pg';

const INSERT_BATCH_SIZE = 100;
const FIELD_COUNT = 31;

export interface PersistedShortStraddleSnapshot {
  venue: string;
  underlying: string;
  sampleSlotTs: Date;
  capturedAt: Date;
  expiry: string;
  expiryTs: Date;
  strike: number;
  spotPriceUsd: number;
  forwardPriceUsd: number;
  callBidUsd: number;
  callAskUsd: number;
  callBidSize: number;
  callAskSize: number;
  callMarkIv: number;
  callDelta: number;
  callVegaUsdPerVolPoint: number;
  callOpenInterest: number;
  callMakerFeeUsd: number;
  callTakerFeeUsd: number;
  callQuoteTs: Date;
  putBidUsd: number;
  putAskUsd: number;
  putBidSize: number;
  putAskSize: number;
  putMarkIv: number;
  putDelta: number;
  putVegaUsdPerVolPoint: number;
  putOpenInterest: number;
  putMakerFeeUsd: number;
  putTakerFeeUsd: number;
  putQuoteTs: Date;
}

export interface ShortStraddleSnapshotStore {
  readonly enabled: boolean;
  writeMany(rows: PersistedShortStraddleSnapshot[]): Promise<void>;
  dispose(): Promise<void>;
}

export class NoopShortStraddleSnapshotStore implements ShortStraddleSnapshotStore {
  readonly enabled = false;
  async writeMany(_rows: PersistedShortStraddleSnapshot[]): Promise<void> {}
  async dispose(): Promise<void> {}
}

export class PostgresShortStraddleSnapshotStore implements ShortStraddleSnapshotStore {
  readonly enabled = true;
  private pool: Pool | null = null;

  constructor(private readonly poolFactory: () => Pool) {}

  static fromConnectionString(connectionString: string): PostgresShortStraddleSnapshotStore {
    return new PostgresShortStraddleSnapshotStore(
      () =>
        new Pool({
          connectionString,
          max: 1,
          connectionTimeoutMillis: 5_000,
          statement_timeout: 10_000,
          query_timeout: 10_000,
          idleTimeoutMillis: 10_000,
        }),
    );
  }

  async writeMany(rows: PersistedShortStraddleSnapshot[]): Promise<void> {
    if (rows.length === 0) return;

    for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((row, batchIndex) => {
        const offset = batchIndex * FIELD_COUNT;
        values.push(
          row.venue,
          row.underlying.toUpperCase(),
          row.sampleSlotTs,
          row.capturedAt,
          row.expiry,
          row.expiryTs,
          row.strike,
          row.spotPriceUsd,
          row.forwardPriceUsd,
          row.callBidUsd,
          row.callAskUsd,
          row.callBidSize,
          row.callAskSize,
          row.callMarkIv,
          row.callDelta,
          row.callVegaUsdPerVolPoint,
          row.callOpenInterest,
          row.callMakerFeeUsd,
          row.callTakerFeeUsd,
          row.callQuoteTs,
          row.putBidUsd,
          row.putAskUsd,
          row.putBidSize,
          row.putAskSize,
          row.putMarkIv,
          row.putDelta,
          row.putVegaUsdPerVolPoint,
          row.putOpenInterest,
          row.putMakerFeeUsd,
          row.putTakerFeeUsd,
          row.putQuoteTs,
        );
        return `(${Array.from({ length: FIELD_COUNT }, (_, fieldIndex) => `$${offset + fieldIndex + 1}`).join(', ')})`;
      });

      await this.getPool().query(
        `INSERT INTO short_straddle_snapshots (
          venue, underlying, sample_slot_ts, captured_at, expiry, expiry_ts, strike,
          spot_price_usd, forward_price_usd,
          call_bid_usd, call_ask_usd, call_bid_size, call_ask_size, call_mark_iv,
          call_delta, call_vega_usd_per_vol_point, call_open_interest, call_maker_fee_usd,
          call_taker_fee_usd, call_quote_ts,
          put_bid_usd, put_ask_usd, put_bid_size, put_ask_size, put_mark_iv,
          put_delta, put_vega_usd_per_vol_point, put_open_interest, put_maker_fee_usd,
          put_taker_fee_usd, put_quote_ts
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (venue, underlying, sample_slot_ts) DO NOTHING`,
        values,
      );
    }
  }

  async dispose(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    if (pool != null) await pool.end();
  }

  private getPool(): Pool {
    this.pool ??= this.poolFactory();
    return this.pool;
  }
}
