import { Pool } from 'pg';

export type SocialBroadcastVenue = 'derive' | 'thalex' | 'paradex';

export interface UserProfileRow {
  userId: string;
  handle: string | null;
  leaderboardVisible: boolean;
  broadcastVenue: SocialBroadcastVenue | null;
  consentedAt: Date | null;
  /** First time the user joined the leaderboard; kept when they leave and rejoin. */
  sharingSince: Date | null;
  updatedAt: Date;
}

export interface UpsertUserProfileInput {
  userId: string;
  handle: string | null;
  leaderboardVisible: boolean;
  broadcastVenue: SocialBroadcastVenue | null;
}

/** A leaderboard member; the venue connection belongs to the user's default account. */
export interface BroadcasterRow {
  userId: string;
  handle: string;
  accountId: string;
  venue: SocialBroadcastVenue;
  sharingSince: Date;
}

export interface ChatMessageRow {
  id: string;
  room: string;
  userId: string;
  alias: string;
  isAnon: boolean;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface ChatModerationRow {
  userId: string;
  mutedUntil: Date | null;
  banned: boolean;
  reason: string | null;
  updatedAt: Date;
}

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`Handle "${handle}" is already taken`);
    this.name = 'HandleTakenError';
  }
}

export interface SocialStore {
  readonly enabled: boolean;
  getProfile(userId: string): Promise<UserProfileRow | null>;
  /**
   * Handles mirror the account username, which the identity provider keeps unique, so a stale
   * copy held by another profile is released (and that profile leaves the leaderboard).
   */
  upsertProfile(input: UpsertUserProfileInput): Promise<UserProfileRow | null>;
  /** Users who joined the leaderboard with a username and a chosen venue account. */
  listBroadcasters(): Promise<BroadcasterRow[]>;
  /** Upserts by id so a later soft-delete of an already-flushed message rides the same batch. */
  upsertChatMessages(rows: ChatMessageRow[]): Promise<number>;
  listRecentChatMessages(room: string, limit: number): Promise<ChatMessageRow[]>;
  getChatMessage(id: string): Promise<ChatMessageRow | null>;
  listChatModeration(): Promise<ChatModerationRow[]>;
  upsertChatModeration(row: ChatModerationRow): Promise<void>;
  dispose(): Promise<void>;
}

export class NoopSocialStore implements SocialStore {
  readonly enabled = false;
  async getProfile(_userId: string): Promise<UserProfileRow | null> {
    return null;
  }
  async upsertProfile(_input: UpsertUserProfileInput): Promise<UserProfileRow | null> {
    return null;
  }
  async listBroadcasters(): Promise<BroadcasterRow[]> {
    return [];
  }
  async upsertChatMessages(_rows: ChatMessageRow[]): Promise<number> {
    return 0;
  }
  async listRecentChatMessages(_room: string, _limit: number): Promise<ChatMessageRow[]> {
    return [];
  }
  async getChatMessage(_id: string): Promise<ChatMessageRow | null> {
    return null;
  }
  async listChatModeration(): Promise<ChatModerationRow[]> {
    return [];
  }
  async upsertChatModeration(_row: ChatModerationRow): Promise<void> {}
  async dispose(): Promise<void> {}
}

interface ProfileRowDb {
  user_id: string;
  handle: string | null;
  leaderboard_visible: boolean;
  broadcast_venue: SocialBroadcastVenue | null;
  leaderboard_consented_at: Date | null;
  leaderboard_since: Date | null;
  updated_at: Date;
}

interface BroadcasterRowDb {
  user_id: string;
  handle: string;
  account_id: string;
  broadcast_venue: SocialBroadcastVenue;
  sharing_since: Date;
}

interface ChatMessageRowDb {
  id: string;
  room: string;
  user_id: string;
  alias: string;
  is_anon: boolean;
  body: string;
  created_at: Date;
  deleted_at: Date | null;
}

interface ChatModerationRowDb {
  user_id: string;
  muted_until: Date | null;
  banned: boolean;
  reason: string | null;
  updated_at: Date;
}

function mapProfile(row: ProfileRowDb): UserProfileRow {
  return {
    userId: row.user_id,
    handle: row.handle,
    leaderboardVisible: row.leaderboard_visible,
    broadcastVenue: row.broadcast_venue,
    consentedAt: row.leaderboard_consented_at,
    sharingSince: row.leaderboard_since,
    updatedAt: row.updated_at,
  };
}

function mapChatMessage(row: ChatMessageRowDb): ChatMessageRow {
  return {
    id: row.id,
    room: row.room,
    userId: row.user_id,
    alias: row.alias,
    isAnon: row.is_anon,
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505'
  );
}

const PROFILE_COLUMNS =
  'user_id, handle, leaderboard_visible, broadcast_venue, leaderboard_consented_at, ' +
  'leaderboard_since, updated_at';

const CHAT_COLUMNS = 'id, room, user_id, alias, is_anon, body, created_at, deleted_at';

export class PostgresSocialStore implements SocialStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresSocialStore {
    return new PostgresSocialStore(
      new Pool({
        connectionString,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000,
        query_timeout: 15_000,
      }),
    );
  }

  async getProfile(userId: string): Promise<UserProfileRow | null> {
    const res = await this.pool.query<ProfileRowDb>(
      `SELECT ${PROFILE_COLUMNS} FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
    const row = res.rows[0];
    return row ? mapProfile(row) : null;
  }

  async upsertProfile(input: UpsertUserProfileInput): Promise<UserProfileRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (input.handle) {
        await client.query(
          `UPDATE user_profiles
           SET handle = NULL, leaderboard_visible = false, updated_at = now()
           WHERE lower(handle) = lower($2) AND user_id <> $1`,
          [input.userId, input.handle],
        );
      }
      const res = await client.query<ProfileRowDb>(
        `INSERT INTO user_profiles
           (user_id, handle, leaderboard_visible, broadcast_venue, leaderboard_consented_at,
            leaderboard_since)
         VALUES ($1, $2, $3, $4, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN now() END)
         ON CONFLICT (user_id) DO UPDATE
           SET handle = EXCLUDED.handle,
               leaderboard_visible = EXCLUDED.leaderboard_visible,
               broadcast_venue = EXCLUDED.broadcast_venue,
               leaderboard_consented_at = CASE
                 WHEN EXCLUDED.leaderboard_visible AND NOT user_profiles.leaderboard_visible
                   THEN now()
                 ELSE user_profiles.leaderboard_consented_at
               END,
               leaderboard_since = COALESCE(
                 user_profiles.leaderboard_since,
                 CASE WHEN EXCLUDED.leaderboard_visible THEN now() END
               ),
               updated_at = now()
         RETURNING ${PROFILE_COLUMNS}`,
        [input.userId, input.handle, input.leaderboardVisible, input.broadcastVenue],
      );
      await client.query('COMMIT');
      const row = res.rows[0];
      return row ? mapProfile(row) : null;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error) && input.handle) throw new HandleTakenError(input.handle);
      throw error;
    } finally {
      client.release();
    }
  }

  async listBroadcasters(): Promise<BroadcasterRow[]> {
    const res = await this.pool.query<BroadcasterRowDb>(
      `SELECT p.user_id, p.handle, u.default_account_id AS account_id, p.broadcast_venue,
              COALESCE(p.leaderboard_since, p.leaderboard_consented_at, p.updated_at)
                AS sharing_since
       FROM user_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.leaderboard_visible
         AND p.handle IS NOT NULL
         AND p.broadcast_venue IS NOT NULL
         AND u.default_account_id IS NOT NULL`,
    );
    return res.rows.map((row) => ({
      userId: row.user_id,
      handle: row.handle,
      accountId: row.account_id,
      venue: row.broadcast_venue,
      sharingSince: row.sharing_since,
    }));
  }

  async upsertChatMessages(rows: ChatMessageRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await this.pool.query(
      `INSERT INTO chat_messages (${CHAT_COLUMNS})
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::text[],
         $5::boolean[], $6::text[], $7::timestamptz[], $8::timestamptz[]
       )
       ON CONFLICT (id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
      [
        rows.map((row) => row.id),
        rows.map((row) => row.room),
        rows.map((row) => row.userId),
        rows.map((row) => row.alias),
        rows.map((row) => row.isAnon),
        rows.map((row) => row.body),
        rows.map((row) => row.createdAt),
        rows.map((row) => row.deletedAt),
      ],
    );
    return res.rowCount ?? 0;
  }

  async listRecentChatMessages(room: string, limit: number): Promise<ChatMessageRow[]> {
    const res = await this.pool.query<ChatMessageRowDb>(
      `SELECT ${CHAT_COLUMNS} FROM chat_messages
       WHERE room = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [room, limit],
    );
    return res.rows.map(mapChatMessage).reverse();
  }

  async getChatMessage(id: string): Promise<ChatMessageRow | null> {
    const res = await this.pool.query<ChatMessageRowDb>(
      `SELECT ${CHAT_COLUMNS} FROM chat_messages WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    return row ? mapChatMessage(row) : null;
  }

  async listChatModeration(): Promise<ChatModerationRow[]> {
    const res = await this.pool.query<ChatModerationRowDb>(
      `SELECT user_id, muted_until, banned, reason, updated_at FROM chat_moderation`,
    );
    return res.rows.map((row) => ({
      userId: row.user_id,
      mutedUntil: row.muted_until,
      banned: row.banned,
      reason: row.reason,
      updatedAt: row.updated_at,
    }));
  }

  async upsertChatModeration(row: ChatModerationRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat_moderation (user_id, muted_until, banned, reason, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET muted_until = EXCLUDED.muted_until,
             banned = EXCLUDED.banned,
             reason = EXCLUDED.reason,
             updated_at = EXCLUDED.updated_at`,
      [row.userId, row.mutedUntil, row.banned, row.reason, row.updatedAt],
    );
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
