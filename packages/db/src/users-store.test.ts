import { describe, expect, it } from 'vitest';
import { NoopUsersStore } from './users-store.js';

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
