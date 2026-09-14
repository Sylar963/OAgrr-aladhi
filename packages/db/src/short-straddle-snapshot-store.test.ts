import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  NoopShortStraddleSnapshotStore,
  type PersistedShortStraddleSnapshot,
  PostgresShortStraddleSnapshotStore,
} from './short-straddle-snapshot-store.js';

const row: PersistedShortStraddleSnapshot = {
  venue: 'deribit',
  underlying: 'btc',
  cohortSlotTs: new Date('2026-07-13T10:00:00.000Z'),
  horizonHours: 0,
  sampleSlotTs: new Date('2026-07-13T10:00:00.000Z'),
  capturedAt: new Date('2026-07-13T10:05:00.000Z'),
  expiry: '2026-07-20',
  expiryTs: new Date('2026-07-20T08:00:00.000Z'),
  strike: 60_000,
  spotPriceUsd: 60_100,
  forwardPriceUsd: 60_200,
  callBidUsd: 1_000,
  callAskUsd: 1_020,
  callBidSize: 2,
  callAskSize: 3,
  callMarkIv: 0.5,
  callDelta: 0.51,
  callVegaUsdPerVolPoint: 120,
  callOpenInterest: 500,
  callMakerFeeUsd: 2,
  callTakerFeeUsd: 3,
  callAskMakerFeeUsd: 2.2,
  callAskTakerFeeUsd: 3.2,
  callQuoteTs: new Date('2026-07-13T10:04:55.000Z'),
  putBidUsd: 900,
  putAskUsd: 930,
  putBidSize: 4,
  putAskSize: 5,
  putMarkIv: 0.52,
  putDelta: -0.49,
  putVegaUsdPerVolPoint: 121,
  putOpenInterest: 600,
  putMakerFeeUsd: 2.1,
  putTakerFeeUsd: 3.1,
  putAskMakerFeeUsd: 2.3,
  putAskTakerFeeUsd: 3.3,
  putQuoteTs: new Date('2026-07-13T10:04:56.000Z'),
};

function createPool() {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [], rowCount: 0 }));
  const end = vi.fn(async () => {});
  return { pool: { query, end } as unknown as Pool, query, end };
}

describe('short-straddle snapshot migration', () => {
  it('creates the non-partitioned table with the hourly idempotency key', () => {
    const sql = readFileSync(
      new URL('../migrations/0019_create_short_straddle_snapshots.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS short_straddle_snapshots');
    expect(sql).toContain('PRIMARY KEY (venue, underlying, sample_slot_ts)');
    expect(sql).toContain('call_vega_usd_per_vol_point DOUBLE PRECISION NOT NULL');
    expect(sql).toContain('put_vega_usd_per_vol_point DOUBLE PRECISION NOT NULL');
    expect(sql).not.toContain('PARTITION BY');
    expect(sql).not.toContain('CREATE INDEX');
  });

  it('adds fixed-cohort horizons and side-specific closing fees', () => {
    const sql = readFileSync(
      new URL('../migrations/0021_short_straddle_follow_up_marks.sql', import.meta.url),
      'utf8',
    );

    expect(sql).toContain('cohort_slot_ts TIMESTAMPTZ');
    expect(sql).toContain('horizon_hours SMALLINT NOT NULL DEFAULT 0');
    expect(sql).toContain('call_ask_taker_fee_usd DOUBLE PRECISION');
    expect(sql).toContain('PRIMARY KEY (venue, underlying, cohort_slot_ts, horizon_hours)');
  });
});

describe('PostgresShortStraddleSnapshotStore', () => {
  it('keeps the pool lazy until the first non-empty insert', async () => {
    const pool = createPool();
    const factory = vi.fn(() => pool.pool);
    const store = new PostgresShortStraddleSnapshotStore(factory);

    await store.writeMany([]);
    await store.dispose();

    expect(factory).not.toHaveBeenCalled();
    expect(pool.end).not.toHaveBeenCalled();
  });

  it('inserts fields and parameters in schema order', async () => {
    const pool = createPool();
    const store = new PostgresShortStraddleSnapshotStore(() => pool.pool);

    await store.writeMany([row]);

    const [sql, values] = pool.query.mock.calls[0] ?? [];
    expect(sql).toContain(
      'venue, underlying, cohort_slot_ts, horizon_hours, sample_slot_ts, captured_at',
    );
    expect(values).toEqual([
      row.venue,
      'BTC',
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
    ]);
    expect(sql).toContain(
      'ON CONFLICT (venue, underlying, cohort_slot_ts, horizon_hours) DO NOTHING',
    );
    await store.dispose();
  });

  it('uses idempotent conflict handling for duplicate slots', async () => {
    const pool = createPool();
    const store = new PostgresShortStraddleSnapshotStore(() => pool.pool);

    await store.writeMany([row, row]);

    expect(pool.query).toHaveBeenCalledOnce();
    expect(pool.query.mock.calls[0]?.[0]).toContain(
      'ON CONFLICT (venue, underlying, cohort_slot_ts, horizon_hours) DO NOTHING',
    );
    await store.dispose();
  });

  it('bounds inserts to one hundred rows per query', async () => {
    const pool = createPool();
    const store = new PostgresShortStraddleSnapshotStore(() => pool.pool);
    const rows = Array.from({ length: 101 }, (_, index) => ({
      ...row,
      sampleSlotTs: new Date(row.sampleSlotTs.getTime() + index * 3_600_000),
    }));

    await store.writeMany(rows);

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0]?.[1]).toHaveLength(3_700);
    expect(pool.query.mock.calls[1]?.[1]).toHaveLength(37);
    await store.dispose();
  });
});

describe('NoopShortStraddleSnapshotStore', () => {
  it('is disabled and no-ops', async () => {
    const store = new NoopShortStraddleSnapshotStore();

    expect(store.enabled).toBe(false);
    await expect(store.writeMany([row])).resolves.toBeUndefined();
    await expect(store.loadSince({ underlying: 'BTC', since: new Date(0) })).resolves.toEqual([]);
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
