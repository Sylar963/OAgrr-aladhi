import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { NoopUsersStore, PostgresUsersStore } from './users-store.js';

describe('PostgresUsersStore account lookup recovery', () => {
  const row = {
    id: 'usr_1', clerk_user_id: 'user_1', email: null, display_name: 'Trader',
    country: null, default_account_id: 'acct_1', created_at: new Date(0),
  };

  it.each([
    new Error('Connection terminated due to connection timeout'),
    new Error('Connection terminated unexpectedly'),
    Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  ])('recovers an existing account after a transient connection failure: %s', async (error) => {
    const query = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({ rows: [row] });
    const store = new PostgresUsersStore({ query } as unknown as Pool);
    await expect(store.getByClerkId('user_1')).resolves.toMatchObject({
      id: 'usr_1', clerkUserId: 'user_1', defaultAccountId: 'acct_1',
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual(query.mock.calls[1]);
    expect(query.mock.calls[0]?.[0]).toMatch(/^SELECT /);
  });

  it('stops after one retry when the connection remains unavailable', async () => {
    const error = new Error('Connection terminated due to connection timeout');
    const query = vi.fn().mockRejectedValue(error);
    const store = new PostgresUsersStore({ query } as unknown as Pool);
    await expect(store.getByClerkId('user_1')).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not retry SQL errors or invent an account on failure', async () => {
    const error = Object.assign(new Error('relation users does not exist'), { code: '42P01' });
    const query = vi.fn().mockRejectedValue(error);
    const store = new PostgresUsersStore({ query } as unknown as Pool);
    await expect(store.getByClerkId('user_1')).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('NoopUsersStore', () => {
  it('is disabled and no-ops', async () => {
    const store = new NoopUsersStore();
    expect(store.enabled).toBe(false);
    await expect(
      store.upsertByClerkId({
        clerkUserId: 'user_abc',
        email: 'a@b.co',
        displayName: 'A',
        accountId: 'acct_1',
      }),
    ).resolves.toBeNull();
    await expect(
      store.provisionByClerkId({
        clerkUserId: 'user_abc',
        email: 'a@b.co',
        displayName: 'A',
        accountId: 'acct_1',
        accountLabel: 'A account',
        initialCashUsd: 100_000,
        createdAt: new Date(0),
      }),
    ).resolves.toBeNull();
    await expect(store.getByClerkId('user_abc')).resolves.toBeNull();
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
