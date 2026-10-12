import { Pool } from 'pg';

export interface UserProfileRow {
  userId: string;
  handle: string | null;
  leaderboardVisible: boolean;
  updatedAt: Date;
}

export interface UpsertUserProfileInput {
  userId: string;
  handle: string | null;
  leaderboardVisible: boolean;
}

export interface AccountBookPosition {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  netQuantity: number;
  avgEntryPriceUsd: number;
}

/** Everything needed to mark a user's default paper account to market. */
export interface AccountBookRow {
  userId: string;
  handle: string | null;
  accountId: string;
  initialCashUsd: number;
  accountCreatedAt: Date;
  cashUsd: number;
  positions: AccountBookPosition[];
}

export interface PaperEquitySnapshotRow {
  accountId: string;
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  equityUsd: number;
  capturedAt: Date;
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
  /** Throws HandleTakenError when another user owns the handle (case-insensitive). */
  upsertProfile(input: UpsertUserProfileInput): Promise<UserProfileRow | null>;
  /** Default paper accounts of all users, or only of users who opted into the leaderboard. */
  listAccountBooks(options: { leaderboardOnly: boolean }): Promise<AccountBookRow[]>;
  /** Earliest snapshot per account on or after `fromDay`, ignoring rows taken before the account's last reset. */
  listEquityBaselines(accountIds: string[], fromDay: string): Promise<PaperEquitySnapshotRow[]>;
  upsertEquitySnapshots(rows: PaperEquitySnapshotRow[]): Promise<number>;
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
  async listAccountBooks(_options: { leaderboardOnly: boolean }): Promise<AccountBookRow[]> {
    return [];
  }
  async listEquityBaselines(
    _accountIds: string[],
    _fromDay: string,
  ): Promise<PaperEquitySnapshotRow[]> {
    return [];
  }
  async upsertEquitySnapshots(_rows: PaperEquitySnapshotRow[]): Promise<number> {
    return 0;
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
  updated_at: Date;
}

interface AccountBookRowDb {
  user_id: string;
  handle: string | null;
  account_id: string;
  initial_cash_usd: string;
  account_created_at: Date;
  cash_usd: string;
  positions: Array<{
    underlying: string;
    expiry: string;
    strike: number | string;
    optionRight: 'call' | 'put';
    netQuantity: number | string;
    avgEntryPriceUsd: number | string;
  }>;
}

interface EquitySnapshotRowDb {
  account_id: string;
  day: string;
  equity_usd: string;
  captured_at: Date;
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
      `SELECT user_id, handle, leaderboard_visible, updated_at
       FROM user_profiles WHERE user_id = $1`,
      [userId],
    );
    const row = res.rows[0];
    return row ? mapProfile(row) : null;
  }

  async upsertProfile(input: UpsertUserProfileInput): Promise<UserProfileRow | null> {
    try {
      const res = await this.pool.query<ProfileRowDb>(
        `INSERT INTO user_profiles (user_id, handle, leaderboard_visible)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET handle = EXCLUDED.handle,
               leaderboard_visible = EXCLUDED.leaderboard_visible,
               updated_at = now()
         RETURNING user_id, handle, leaderboard_visible, updated_at`,
        [input.userId, input.handle, input.leaderboardVisible],
      );
      const row = res.rows[0];
      return row ? mapProfile(row) : null;
    } catch (error) {
      if (isUniqueViolation(error) && input.handle) throw new HandleTakenError(input.handle);
      throw error;
    }
  }

  async listAccountBooks(options: { leaderboardOnly: boolean }): Promise<AccountBookRow[]> {
    const res = await this.pool.query<AccountBookRowDb>(
      `SELECT u.id AS user_id,
              p.handle,
              a.id AS account_id,
              a.initial_cash_usd,
              a.created_at AS account_created_at,
              COALESCE(
                (SELECT SUM(c.delta_usd) FROM paper_cash_ledger c WHERE c.account_id = a.id),
                0
              ) AS cash_usd,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'underlying', pp.underlying,
                          'expiry', to_char(pp.expiry, 'YYYY-MM-DD'),
                          'strike', pp.strike,
                          'optionRight', pp.option_right,
                          'netQuantity', pp.net_quantity,
                          'avgEntryPriceUsd', pp.avg_entry_price_usd))
                 FROM paper_positions pp
                 WHERE pp.account_id = a.id AND pp.net_quantity <> 0),
                '[]'::json
              ) AS positions
       FROM users u
       JOIN paper_accounts a ON a.id = u.default_account_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE NOT $1::boolean OR (p.leaderboard_visible AND p.handle IS NOT NULL)`,
      [options.leaderboardOnly],
    );
    return res.rows.map((row) => ({
      userId: row.user_id,
      handle: row.handle,
      accountId: row.account_id,
      initialCashUsd: Number(row.initial_cash_usd),
      accountCreatedAt: row.account_created_at,
      cashUsd: Number(row.cash_usd),
      positions: row.positions.map((pos) => ({
        underlying: pos.underlying,
        expiry: pos.expiry,
        strike: Number(pos.strike),
        optionRight: pos.optionRight,
        netQuantity: Number(pos.netQuantity),
        avgEntryPriceUsd: Number(pos.avgEntryPriceUsd),
      })),
    }));
  }

  async listEquityBaselines(
    accountIds: string[],
    fromDay: string,
  ): Promise<PaperEquitySnapshotRow[]> {
    if (accountIds.length === 0) return [];
    const res = await this.pool.query<EquitySnapshotRowDb>(
      `SELECT DISTINCT ON (s.account_id)
              s.account_id, to_char(s.day, 'YYYY-MM-DD') AS day, s.equity_usd, s.captured_at
       FROM paper_equity_snapshots s
       JOIN paper_accounts a ON a.id = s.account_id
       WHERE s.account_id = ANY($1::text[])
         AND s.day >= $2::date
         AND s.captured_at >= a.created_at
       ORDER BY s.account_id, s.day ASC`,
      [accountIds, fromDay],
    );
    return res.rows.map((row) => ({
      accountId: row.account_id,
      day: row.day,
      equityUsd: Number(row.equity_usd),
      capturedAt: row.captured_at,
    }));
  }

  async upsertEquitySnapshots(rows: PaperEquitySnapshotRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await this.pool.query(
      `INSERT INTO paper_equity_snapshots (account_id, day, equity_usd, captured_at)
       SELECT * FROM unnest($1::text[], $2::date[], $3::numeric[], $4::timestamptz[])
       ON CONFLICT (account_id, day) DO UPDATE
         SET equity_usd = EXCLUDED.equity_usd,
             captured_at = EXCLUDED.captured_at`,
      [
        rows.map((row) => row.accountId),
        rows.map((row) => row.day),
        rows.map((row) => row.equityUsd),
        rows.map((row) => row.capturedAt),
      ],
    );
    return res.rowCount ?? 0;
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
