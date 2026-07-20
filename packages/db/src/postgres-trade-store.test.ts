import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresTradeStore } from './postgres-trade-store.js';
import type { PersistedTradeRecord } from './types.js';

function trade(tradeUid: string, tradeTs: Date): PersistedTradeRecord {
  return {
    tradeUid,
    mode: 'live',
    venue: 'deribit',
    underlying: 'BTC',
    instrumentName: 'BTC-30JUN26-70000-C',
    tradeTs,
    ingestedAt: new Date('2026-07-20T00:00:00Z'),
    direction: 'buy',
    contracts: 1,
    price: 0.01,
    premiumUsd: 700,
    notionalUsd: 70_000,
    referencePriceUsd: 70_000,
    expiry: '2026-06-30',
    strike: 70_000,
    optionType: 'call',
    iv: 0.5,
    markPrice: 0.01,
    isBlock: false,
    strategyLabel: null,
    legs: null,
    raw: {},
  };
}

describe('PostgresTradeStore', () => {
  it('ensures each trade month once before inserting records', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const pool = { query, end: vi.fn() } as unknown as Pool;
    const store = new PostgresTradeStore(pool);

    await store.writeMany([
      trade('old', new Date('2024-01-11T18:08:14.516Z')),
      trade('current', new Date('2026-07-20T00:00:00Z')),
    ]);
    await store.writeMany([trade('same-old-month', new Date('2024-01-12T00:00:00Z'))]);

    const partitionCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes('flow_trades_ensure_month_partition'),
    );
    expect(partitionCalls).toEqual([
      [
        'SELECT flow_trades_ensure_month_partition($1::timestamptz)',
        [new Date('2024-01-01T00:00:00Z')],
      ],
      [
        'SELECT flow_trades_ensure_month_partition($1::timestamptz)',
        [new Date('2026-07-01T00:00:00Z')],
      ],
    ]);
    expect(String(query.mock.calls[2]?.[0])).toContain('INSERT INTO flow_trades');
    expect(String(query.mock.calls[3]?.[0])).toContain('INSERT INTO flow_trades');
  });

  it('inserts up to one thousand records per database round trip', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const pool = { query, end: vi.fn() } as unknown as Pool;
    const store = new PostgresTradeStore(pool);
    const rows = Array.from({ length: 1_001 }, (_, index) =>
      trade(`trade-${index}`, new Date('2026-07-20T00:00:00Z')),
    );

    await store.writeMany(rows);

    const insertCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO flow_trades'),
    );
    expect(insertCalls).toHaveLength(2);
  });
});
