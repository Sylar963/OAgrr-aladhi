import { Pool } from 'pg';

const INSERT_BATCH_SIZE = 100;
const FIELD_COUNT = 37;

export type ShortStraddleHorizonHours = 0 | 1 | 6 | 24 | 72;

export interface ShortStraddleSnapshotLoadQuery {
  underlying: string;
  since: Date;
}

export interface PersistedShortStraddleSnapshot {
  venue: string;
  underlying: string;
  cohortSlotTs: Date;
  horizonHours: ShortStraddleHorizonHours;
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
  callAskMakerFeeUsd: number;
  callAskTakerFeeUsd: number;
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
  putAskMakerFeeUsd: number;
  putAskTakerFeeUsd: number;
  putQuoteTs: Date;
}

export interface ShortStraddleSnapshotStore {
  readonly enabled: boolean;
  writeMany(rows: PersistedShortStraddleSnapshot[]): Promise<void>;
  loadSince(query: ShortStraddleSnapshotLoadQuery): Promise<PersistedShortStraddleSnapshot[]>;
  dispose(): Promise<void>;
}

export class NoopShortStraddleSnapshotStore implements ShortStraddleSnapshotStore {
  readonly enabled = false;
  async writeMany(_rows: PersistedShortStraddleSnapshot[]): Promise<void> {}
  async loadSince(_query: ShortStraddleSnapshotLoadQuery): Promise<PersistedShortStraddleSnapshot[]> {
    return [];
  }
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
          row.cohortSlotTs,
          row.horizonHours,
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
          row.callAskMakerFeeUsd,
          row.callAskTakerFeeUsd,
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
          row.putAskMakerFeeUsd,
          row.putAskTakerFeeUsd,
          row.putQuoteTs,
        );
        return `(${Array.from({ length: FIELD_COUNT }, (_, fieldIndex) => `$${offset + fieldIndex + 1}`).join(', ')})`;
      });

      await this.getPool().query(
        `INSERT INTO short_straddle_snapshots (
          venue, underlying, cohort_slot_ts, horizon_hours, sample_slot_ts, captured_at,
          expiry, expiry_ts, strike,
          spot_price_usd, forward_price_usd,
          call_bid_usd, call_ask_usd, call_bid_size, call_ask_size, call_mark_iv,
          call_delta, call_vega_usd_per_vol_point, call_open_interest, call_maker_fee_usd,
          call_taker_fee_usd, call_ask_maker_fee_usd, call_ask_taker_fee_usd, call_quote_ts,
          put_bid_usd, put_ask_usd, put_bid_size, put_ask_size, put_mark_iv,
          put_delta, put_vega_usd_per_vol_point, put_open_interest, put_maker_fee_usd,
          put_taker_fee_usd, put_ask_maker_fee_usd, put_ask_taker_fee_usd, put_quote_ts
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (venue, underlying, cohort_slot_ts, horizon_hours) DO NOTHING`,
        values,
      );
    }
  }

  async loadSince(
    query: ShortStraddleSnapshotLoadQuery,
  ): Promise<PersistedShortStraddleSnapshot[]> {
    const result = await this.getPool().query<ShortStraddleSnapshotRow>(
      `SELECT
        venue, underlying, cohort_slot_ts, horizon_hours, sample_slot_ts, captured_at,
        expiry::text, expiry_ts, strike, spot_price_usd, forward_price_usd,
        call_bid_usd, call_ask_usd, call_bid_size, call_ask_size, call_mark_iv,
        call_delta, call_vega_usd_per_vol_point, call_open_interest, call_maker_fee_usd,
        call_taker_fee_usd, call_ask_maker_fee_usd, call_ask_taker_fee_usd, call_quote_ts,
        put_bid_usd, put_ask_usd, put_bid_size, put_ask_size, put_mark_iv,
        put_delta, put_vega_usd_per_vol_point, put_open_interest, put_maker_fee_usd,
        put_taker_fee_usd, put_ask_maker_fee_usd, put_ask_taker_fee_usd, put_quote_ts
      FROM short_straddle_snapshots
      WHERE underlying = $1 AND cohort_slot_ts >= $2
      ORDER BY cohort_slot_ts, horizon_hours, venue`,
      [query.underlying.toUpperCase(), query.since],
    );
    return result.rows.map(mapSnapshotRow);
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

interface ShortStraddleSnapshotRow {
  venue: string;
  underlying: string;
  cohort_slot_ts: Date;
  horizon_hours: ShortStraddleHorizonHours;
  sample_slot_ts: Date;
  captured_at: Date;
  expiry: string;
  expiry_ts: Date;
  strike: number;
  spot_price_usd: number;
  forward_price_usd: number;
  call_bid_usd: number;
  call_ask_usd: number;
  call_bid_size: number;
  call_ask_size: number;
  call_mark_iv: number;
  call_delta: number;
  call_vega_usd_per_vol_point: number;
  call_open_interest: number;
  call_maker_fee_usd: number;
  call_taker_fee_usd: number;
  call_ask_maker_fee_usd: number;
  call_ask_taker_fee_usd: number;
  call_quote_ts: Date;
  put_bid_usd: number;
  put_ask_usd: number;
  put_bid_size: number;
  put_ask_size: number;
  put_mark_iv: number;
  put_delta: number;
  put_vega_usd_per_vol_point: number;
  put_open_interest: number;
  put_maker_fee_usd: number;
  put_taker_fee_usd: number;
  put_ask_maker_fee_usd: number;
  put_ask_taker_fee_usd: number;
  put_quote_ts: Date;
}

function mapSnapshotRow(row: ShortStraddleSnapshotRow): PersistedShortStraddleSnapshot {
  return {
    venue: row.venue,
    underlying: row.underlying,
    cohortSlotTs: row.cohort_slot_ts,
    horizonHours: row.horizon_hours,
    sampleSlotTs: row.sample_slot_ts,
    capturedAt: row.captured_at,
    expiry: row.expiry,
    expiryTs: row.expiry_ts,
    strike: row.strike,
    spotPriceUsd: row.spot_price_usd,
    forwardPriceUsd: row.forward_price_usd,
    callBidUsd: row.call_bid_usd,
    callAskUsd: row.call_ask_usd,
    callBidSize: row.call_bid_size,
    callAskSize: row.call_ask_size,
    callMarkIv: row.call_mark_iv,
    callDelta: row.call_delta,
    callVegaUsdPerVolPoint: row.call_vega_usd_per_vol_point,
    callOpenInterest: row.call_open_interest,
    callMakerFeeUsd: row.call_maker_fee_usd,
    callTakerFeeUsd: row.call_taker_fee_usd,
    callAskMakerFeeUsd: row.call_ask_maker_fee_usd,
    callAskTakerFeeUsd: row.call_ask_taker_fee_usd,
    callQuoteTs: row.call_quote_ts,
    putBidUsd: row.put_bid_usd,
    putAskUsd: row.put_ask_usd,
    putBidSize: row.put_bid_size,
    putAskSize: row.put_ask_size,
    putMarkIv: row.put_mark_iv,
    putDelta: row.put_delta,
    putVegaUsdPerVolPoint: row.put_vega_usd_per_vol_point,
    putOpenInterest: row.put_open_interest,
    putMakerFeeUsd: row.put_maker_fee_usd,
    putTakerFeeUsd: row.put_taker_fee_usd,
    putAskMakerFeeUsd: row.put_ask_maker_fee_usd,
    putAskTakerFeeUsd: row.put_ask_taker_fee_usd,
    putQuoteTs: row.put_quote_ts,
  };
}
