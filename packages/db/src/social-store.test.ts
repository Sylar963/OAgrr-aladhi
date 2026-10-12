import { describe, expect, it } from 'vitest';
import { NoopSocialStore } from './social-store.js';

describe('NoopSocialStore', () => {
  it('is disabled and returns empty results', async () => {
    const store = new NoopSocialStore();
    expect(store.enabled).toBe(false);
    await expect(store.getProfile('usr_1')).resolves.toBeNull();
    await expect(store.listAccountBooks({ leaderboardOnly: true })).resolves.toEqual([]);
    await expect(store.upsertChatMessages([])).resolves.toBe(0);
    await expect(store.listRecentChatMessages('global', 10)).resolves.toEqual([]);
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
