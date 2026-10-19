import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresThesisStore, type PersistedThesis } from './thesis-store.js';

const thesis = (id: string, state: string): PersistedThesis => ({
  id,
  accountId: 'acct_1',
  underlying: 'BTC',
  state,
  createdAt: new Date(0),
  endedAt: null,
  record: { id, state },
});

function fakePool() {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [], rowCount: 1 }));
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  return { pool, query, release };
}

describe('PostgresThesisStore.save', () => {
  it('writes theses and events in one transaction, keeping the latest row per thesis id', async () => {
    const { pool, query, release } = fakePool();
    const store = new PostgresThesisStore(pool);
    await store.save(
      [thesis('a', 'active'), thesis('a', 'ended_early')],
      [
        {
          id: 'e1',
          thesisId: 'a',
          accountId: 'acct_1',
          kind: 'created',
          payload: {},
          createdAt: new Date(0),
        },
      ],
    );
    const sql = query.mock.calls.map(([text]) => text.trim().split(/\s+/)[0]);
    expect(sql).toEqual(['BEGIN', 'INSERT', 'INSERT', 'COMMIT']);
    const thesisParams = query.mock.calls[1]?.[1] as unknown[][];
    expect(thesisParams[0]).toEqual(['a']);
    expect(thesisParams[3]).toEqual(['ended_early']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and rethrows when a write fails', async () => {
    const { pool, query, release } = fakePool();
    query.mockImplementation(async (text: string) => {
      if (text.includes('thesis_events')) throw new Error('boom');
      return { rows: [], rowCount: 1 };
    });
    const store = new PostgresThesisStore(pool);
    await expect(
      store.save(
        [thesis('a', 'active')],
        [{ id: 'e1', thesisId: 'a', accountId: 'acct_1', kind: 'created', payload: {}, createdAt: new Date(0) }],
      ),
    ).rejects.toThrow('boom');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('skips the database for an empty batch', async () => {
    const { pool } = fakePool();
    expect(await new PostgresThesisStore(pool).save([], [])).toEqual({ theses: 0, events: 0 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
