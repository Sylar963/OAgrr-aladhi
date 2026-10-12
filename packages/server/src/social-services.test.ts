import type { UserProfileRow } from '@oggregator/db';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./trading-services.js', () => ({ quoteProvider: { getMark: async () => null } }));
vi.mock('./routes/paper/workspace.js', () => ({ listTradeSummaries: async () => [] }));

const { SocialProfileService, UsernameRequiredError } = await import('./social-services.js');

function fakeStore(initial: UserProfileRow | null = null) {
  let row = initial;
  return {
    getProfile: vi.fn(async () => row),
    upsertProfile: vi.fn(
      async (input: { userId: string; handle: string | null; leaderboardVisible: boolean }) => {
        row = {
          userId: input.userId,
          handle: input.handle,
          leaderboardVisible: input.leaderboardVisible,
          consentedAt: input.leaderboardVisible ? new Date('2026-10-12T12:00:00.000Z') : null,
          updatedAt: new Date('2026-10-12T12:00:00.000Z'),
        };
        return row;
      },
    ),
  };
}

const USER = { id: 'usr_1', clerkUserId: 'user_clerk_1' };

describe('SocialProfileService', () => {
  it('mirrors the account username and writes only when it changes', async () => {
    const store = fakeStore();
    const onChange = vi.fn();
    const service = new SocialProfileService(store, async () => 'aladhi', onChange);

    await expect(service.sync(USER)).resolves.toMatchObject({ handle: 'aladhi' });
    await service.sync(USER);
    expect(store.upsertProfile).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored handle when the username lookup fails', async () => {
    const store = fakeStore({
      userId: 'usr_1',
      handle: 'aladhi',
      leaderboardVisible: true,
      consentedAt: null,
      updatedAt: new Date(),
    });
    const service = new SocialProfileService(store, async () => undefined, vi.fn());
    await expect(service.sync(USER)).resolves.toMatchObject({
      handle: 'aladhi',
      leaderboardVisible: true,
    });
    expect(store.upsertProfile).not.toHaveBeenCalled();
  });

  it('requires a username to join and drops off when the username is removed', async () => {
    let username: string | null = null;
    const store = fakeStore();
    const service = new SocialProfileService(store, async () => username, vi.fn());

    await expect(service.setLeaderboardVisible(USER, true)).rejects.toBeInstanceOf(
      UsernameRequiredError,
    );

    username = 'aladhi';
    await expect(service.setLeaderboardVisible(USER, true)).resolves.toMatchObject({
      handle: 'aladhi',
      leaderboardVisible: true,
    });

    username = null;
    await expect(service.sync(USER)).resolves.toMatchObject({
      handle: null,
      leaderboardVisible: false,
    });
  });
});
