import type { UpsertUserProfileInput, UserProfileRow } from '@oggregator/db';
import type { SocialVenueConnection } from '@oggregator/protocol';
import { describe, expect, it, vi } from 'vitest';

import { SocialProfileError, SocialProfileService } from './social-profile.js';

const AT = new Date('2026-10-12T12:00:00.000Z');

function fakeStore(initial: UserProfileRow | null = null) {
  let row = initial;
  return {
    getProfile: vi.fn(async () => row),
    upsertProfile: vi.fn(async (input: UpsertUserProfileInput) => {
      row = { ...input, consentedAt: input.leaderboardVisible ? AT : null, updatedAt: AT };
      return row;
    }),
  };
}

const USER = { id: 'usr_1', clerkUserId: 'user_clerk_1', accountId: 'acct_1' };
const DERIVE: SocialVenueConnection[] = [{ venue: 'derive', connected: true }];

function create(options: {
  username?: () => string | null | undefined;
  venues?: SocialVenueConnection[];
  row?: UserProfileRow | null;
}) {
  const store = fakeStore(options.row ?? null);
  const onChange = vi.fn();
  const service = new SocialProfileService(
    store,
    async () => (options.username ? options.username() : 'aladhi'),
    async () => options.venues ?? DERIVE,
    onChange,
  );
  return { service, store, onChange };
}

describe('SocialProfileService', () => {
  it('mirrors the account username and writes only when it changes', async () => {
    const { service, store, onChange } = create({});
    await expect(service.view(USER)).resolves.toMatchObject({ handle: 'aladhi', venues: DERIVE });
    await service.sync(USER);
    expect(store.upsertProfile).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored handle when the username lookup fails', async () => {
    const { service, store } = create({
      username: () => undefined,
      row: {
        userId: 'usr_1',
        handle: 'aladhi',
        leaderboardVisible: true,
        broadcastVenue: 'derive',
        consentedAt: null,
        updatedAt: AT,
      },
    });
    await expect(service.sync(USER)).resolves.toMatchObject({
      handle: 'aladhi',
      leaderboardVisible: true,
    });
    expect(store.upsertProfile).not.toHaveBeenCalled();
  });

  it('requires a username and a connected venue account to join', async () => {
    let username: string | null = null;
    const { service } = create({ username: () => username });
    await expect(
      service.update(USER, { leaderboardVisible: true, broadcastVenue: 'derive' }),
    ).rejects.toMatchObject({ code: 'username_required' });

    username = 'aladhi';
    await expect(service.update(USER, { leaderboardVisible: true })).rejects.toMatchObject({
      code: 'venue_required',
    });
    await expect(
      service.update(USER, { leaderboardVisible: true, broadcastVenue: 'thalex' }),
    ).rejects.toBeInstanceOf(SocialProfileError);
    await expect(
      service.update(USER, { leaderboardVisible: true, broadcastVenue: 'derive' }),
    ).resolves.toMatchObject({ leaderboardVisible: true, broadcastVenue: 'derive' });
  });

  it('lets a member leave after their venue was disconnected', async () => {
    const { service } = create({
      venues: [],
      row: {
        userId: 'usr_1',
        handle: 'aladhi',
        leaderboardVisible: true,
        broadcastVenue: 'derive',
        consentedAt: AT,
        updatedAt: AT,
      },
    });
    await expect(service.update(USER, { leaderboardVisible: false })).resolves.toMatchObject({
      leaderboardVisible: false,
      broadcastVenue: 'derive',
    });
  });

  it('drops off the leaderboard when the username is removed', async () => {
    let username: string | null = 'aladhi';
    const { service } = create({ username: () => username });
    await service.update(USER, { leaderboardVisible: true, broadcastVenue: 'derive' });
    username = null;
    await expect(service.sync(USER)).resolves.toMatchObject({
      handle: null,
      leaderboardVisible: false,
    });
  });
});
