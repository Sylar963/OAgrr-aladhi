import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  type PersistedGexWallSnapshot,
  PostgresGexWallSnapshotStore,
} from './gex-wall-snapshot-store.js';

function snapshot(index: number): PersistedGexWallSnapshot {
  return {
    underlying: 'btc',
    slotTs: new Date(index * 900_000),
    spot: 60_000,
    callWall: 65_000,
    putWall: null,
    gammaFlip: 61_000,
  };
}

describe('PostgresGexWallSnapshotStore', () => {
  it('inserts in batches with ON CONFLICT DO NOTHING', async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [] }));
    const store = new PostgresGexWallSnapshotStore({ query } as unknown as Pool);

    await store.writeMany(Array.from({ length: 501 }, (_, index) => snapshot(index)));

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT (underlying, slot_ts) DO NOTHING');
    expect(query.mock.calls[0]?.[1].slice(0, 6)).toEqual([
      'BTC',
      new Date(0),
      60_000,
      65_000,
      null,
      61_000,
    ]);
    expect(query.mock.calls[1]?.[1]).toHaveLength(6);
  });

  it('does nothing for an empty list', async () => {
    const query = vi.fn();
    await new PostgresGexWallSnapshotStore({ query } as unknown as Pool).writeMany([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('maps loaded rows and reports pruned counts', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            underlying: 'ETH',
            slot_ts: new Date(0),
            spot: 3_000,
            call_wall: null,
            put_wall: 2_800,
            gamma_flip: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 4 });
    const store = new PostgresGexWallSnapshotStore({ query } as unknown as Pool);

    expect(await store.loadSince(new Date(0))).toEqual([
      {
        underlying: 'ETH',
        slotTs: new Date(0),
        spot: 3_000,
        callWall: null,
        putWall: 2_800,
        gammaFlip: null,
      },
    ]);
    expect(await store.prune(new Date(0))).toBe(4);
  });
});
