import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  type PersistedBreakEvenSnapshot,
  PostgresBreakEvenSnapshotStore,
} from './break-even-snapshot-store.js';

function snapshot(index: number): PersistedBreakEvenSnapshot {
  return {
    underlying: 'btc',
    expiry: '2026-11-27',
    expiryTs: new Date('2026-11-27T08:00:00.000Z'),
    slotTs: new Date(index * 3_600_000),
    spot: 64_000,
    forward: 64_200,
    strikes: [60_000, 70_000],
    markIvs: [0.42, 0.4],
  };
}

describe('PostgresBreakEvenSnapshotStore', () => {
  it('inserts in batches with ON CONFLICT DO NOTHING', async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [] }));
    const store = new PostgresBreakEvenSnapshotStore({ query } as unknown as Pool);

    await store.writeMany(Array.from({ length: 201 }, (_, index) => snapshot(index)));

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain(
      'ON CONFLICT (underlying, expiry, slot_ts) DO NOTHING',
    );
    expect(query.mock.calls[0]?.[1].slice(0, 8)).toEqual([
      'BTC',
      '2026-11-27',
      new Date(0),
      new Date('2026-11-27T08:00:00.000Z'),
      64_000,
      64_200,
      [60_000, 70_000],
      [0.42, 0.4],
    ]);
    expect(query.mock.calls[1]?.[1]).toHaveLength(8);
  });

  it('does nothing for an empty list', async () => {
    const query = vi.fn();
    await new PostgresBreakEvenSnapshotStore({ query } as unknown as Pool).writeMany([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('maps loaded rows and reports pruned counts', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            underlying: 'ETH',
            expiry: '2026-11-27',
            slot_ts: new Date(0),
            expiry_ts: new Date('2026-11-27T08:00:00.000Z'),
            spot: 3_000,
            forward: 3_010,
            strikes: [2_800],
            mark_ivs: [0.55],
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 3 });
    const store = new PostgresBreakEvenSnapshotStore({ query } as unknown as Pool);

    expect(await store.loadActive(new Date(0))).toEqual([
      {
        underlying: 'ETH',
        expiry: '2026-11-27',
        slotTs: new Date(0),
        expiryTs: new Date('2026-11-27T08:00:00.000Z'),
        spot: 3_000,
        forward: 3_010,
        strikes: [2_800],
        markIvs: [0.55],
      },
    ]);
    expect(await store.prune(new Date(0))).toBe(3);
  });
});
