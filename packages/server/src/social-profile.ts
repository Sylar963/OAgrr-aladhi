import type { SocialStore, UserProfileRow } from '@oggregator/db';
import type {
  SocialProfileDto,
  SocialVenue,
  SocialVenueConnection,
  UpdateSocialProfileRequest,
} from '@oggregator/protocol';

export type SocialProfile = Omit<SocialProfileDto, 'venues'>;

export type SocialProfileErrorCode = 'username_required' | 'venue_required' | 'venue_not_connected';

export class SocialProfileError extends Error {
  constructor(
    readonly code: SocialProfileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SocialProfileError';
  }
}

export interface SocialUser {
  id: string;
  clerkUserId: string;
  accountId: string;
}

type UsernameLookup = (clerkUserId: string) => Promise<string | null | undefined>;
type VenueConnectionLookup = (accountId: string) => Promise<SocialVenueConnection[]>;

const DEFAULT_PROFILE: SocialProfile = {
  handle: null,
  leaderboardVisible: false,
  broadcastVenue: null,
  consentedAt: null,
};

function toProfile(row: UserProfileRow): SocialProfile {
  return {
    handle: row.handle,
    leaderboardVisible: row.leaderboardVisible,
    broadcastVenue: row.broadcastVenue,
    consentedAt: row.consentedAt?.toISOString() ?? null,
  };
}

/**
 * The handle is the account username, re-read from Clerk whenever the Social tab loads; the
 * database is written only when it, the leaderboard opt-in or the broadcast venue changes.
 * Profiles are cached per process because every chat connect and named post reads one.
 */
export class SocialProfileService {
  private readonly cache = new Map<string, SocialProfile>();

  constructor(
    private readonly store: Pick<SocialStore, 'getProfile' | 'upsertProfile'>,
    private readonly lookupUsername: UsernameLookup,
    private readonly listVenueConnections: VenueConnectionLookup,
    private readonly onChange: (userId: string, profile: SocialProfile) => void,
  ) {}

  async get(userId: string): Promise<SocialProfile> {
    const cached = this.cache.get(userId);
    if (cached) return cached;
    const row = await this.store.getProfile(userId);
    const profile = row ? toProfile(row) : DEFAULT_PROFILE;
    this.cache.set(userId, profile);
    return profile;
  }

  async view(user: SocialUser): Promise<SocialProfileDto> {
    const [synced, venues] = await Promise.all([
      this.sync(user),
      this.listVenueConnections(user.accountId),
    ]);
    const only = venues.length === 1 ? venues[0]!.venue : null;
    const profile =
      synced.leaderboardVisible && !synced.broadcastVenue && only
        ? await this.save(user.id, { ...synced, broadcastVenue: only })
        : synced;
    return { ...profile, venues };
  }

  async sync(user: SocialUser): Promise<SocialProfile> {
    const current = await this.get(user.id);
    const username = await this.lookupUsername(user.clerkUserId);
    if (username === undefined || username === current.handle) return current;
    return this.save(user.id, {
      ...current,
      handle: username,
      leaderboardVisible: username ? current.leaderboardVisible : false,
    });
  }

  async update(user: SocialUser, request: UpdateSocialProfileRequest): Promise<SocialProfileDto> {
    const current = await this.sync(user);
    const venues = await this.listVenueConnections(user.accountId);
    const broadcastVenue: SocialVenue | null =
      request.broadcastVenue === undefined ? current.broadcastVenue : request.broadcastVenue;

    if (request.leaderboardVisible) {
      if (!current.handle) {
        throw new SocialProfileError(
          'username_required',
          'Set a username on your account to join the leaderboard',
        );
      }
      if (!broadcastVenue) {
        throw new SocialProfileError(
          'venue_required',
          'Choose which connected venue account to broadcast',
        );
      }
    }
    const choosing = request.leaderboardVisible || request.broadcastVenue !== undefined;
    if (choosing && broadcastVenue && !venues.some((entry) => entry.venue === broadcastVenue)) {
      throw new SocialProfileError(
        'venue_not_connected',
        `Connect your ${broadcastVenue} account before broadcasting it`,
      );
    }

    const unchanged =
      current.leaderboardVisible === request.leaderboardVisible &&
      current.broadcastVenue === broadcastVenue;
    const profile = unchanged
      ? current
      : await this.save(user.id, {
          ...current,
          leaderboardVisible: request.leaderboardVisible,
          broadcastVenue,
        });
    return { ...profile, venues };
  }

  private async save(userId: string, next: SocialProfile): Promise<SocialProfile> {
    const row = await this.store.upsertProfile({
      userId,
      handle: next.handle,
      leaderboardVisible: next.leaderboardVisible,
      broadcastVenue: next.broadcastVenue,
    });
    const profile = row ? toProfile(row) : next;
    if (next.handle) {
      const wanted = next.handle.toLowerCase();
      for (const [otherId, other] of this.cache) {
        if (otherId !== userId && other.handle?.toLowerCase() === wanted) {
          this.cache.delete(otherId);
        }
      }
    }
    this.cache.set(userId, profile);
    this.onChange(userId, profile);
    return profile;
  }
}
