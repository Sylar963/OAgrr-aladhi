import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresRegimeStore, type PersistedRegimeObservation } from './regime-store.js';

function observation(underlying: string, ts: number, dominant: 'low-vol' | 'high-vol'): PersistedRegimeObservation {
  return { underlying, ts: new Date(ts), features: [0.1], posterior: null, dominant };
}

describe('PostgresRegimeStore.saveObservations', () => {
  it('batches rows and keeps only the last row per key within a batch', async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [] }));
    const store = new PostgresRegimeStore({ query } as unknown as Pool);

    const rows = Array.from({ length: 1_200 }, (_, index) => observation('btc', index, 'low-vol'));
    rows.push(observation('BTC', 0, 'high-vol'));
    await store.saveObservations(rows);

    expect(query).toHaveBeenCalledTimes(3);
    const values = query.mock.calls.flatMap(([, params]) => params);
    expect(values).toHaveLength(1_200 * 5);
    expect(values.slice(0, 5)).toEqual(['BTC', new Date(0), '[0.1]', null, 'high-vol']);
  });

  it('does nothing for an empty list', async () => {
    const query = vi.fn();
    await new PostgresRegimeStore({ query } as unknown as Pool).saveObservations([]);
    expect(query).not.toHaveBeenCalled();
  });
});
