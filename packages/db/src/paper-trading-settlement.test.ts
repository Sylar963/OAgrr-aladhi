import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresPaperTradingStore } from './paper-trading-store.js';

function createStore() {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [], rowCount: 0 }));
  const end = vi.fn(async () => {});
  const pool = { query, end } as unknown as Pool;
  return { store: new PostgresPaperTradingStore(pool), query };
}

describe('PostgresPaperTradingStore settlement persistence', () => {
  it('treats an expiry as eligible at 08:00 UTC on its expiry date', async () => {
    const { store, query } = createStore();
    const asOf = new Date('2026-04-25T08:05:00.000Z');

    await store.listExpiredOpenPositions('acct_1', asOf);

    expect(query.mock.calls[0]?.[0]).toContain(
      "expiry + TIME '08:00:00' <= ($2::timestamptz AT TIME ZONE 'UTC')",
    );
    expect(query.mock.calls[0]?.[1]).toEqual(['acct_1', asOf]);
  });

  it('allows an official settlement to replace only a spot fallback', async () => {
    const { store, query } = createStore();
    const capturedAt = new Date('2026-04-25T08:05:00.000Z');

    await store.upsertSettlementPrice({
      underlying: 'BTC',
      expiry: '2026-04-25',
      priceUsd: 93_000,
      source: 'gateio',
      capturedAt,
    });

    const sql = query.mock.calls[0]?.[0];
    expect(sql).toContain('ON CONFLICT (underlying, expiry) DO UPDATE SET');
    expect(sql).toContain("paper_settlement_prices.source = 'spot-runtime'");
    expect(sql).toContain("EXCLUDED.source <> 'spot-runtime'");
    expect(query.mock.calls[0]?.[1]).toEqual(['BTC', '2026-04-25', 93_000, 'gateio', capturedAt]);
  });
});
