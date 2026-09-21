import { Pool } from 'pg';

export interface UserRow {
  id: string;
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
  country: string | null;
  defaultAccountId: string | null;
  createdAt: Date;
}

export interface UpsertUserInput {
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
  accountId: string;
}

export interface ProvisionUserInput extends UpsertUserInput {
  accountLabel: string;
  initialCashUsd: number;
  createdAt: Date;
}

export interface UsersStore {
  readonly enabled: boolean;
  /** Insert the user keyed by clerk_user_id, or return the existing row.
   * On insert, links the freshly-created paper account as default_account_id. */
  upsertByClerkId(input: UpsertUserInput): Promise<UserRow | null>;
  provisionByClerkId(input: ProvisionUserInput): Promise<UserRow | null>;
  getByClerkId(clerkUserId: string): Promise<UserRow | null>;
  dispose(): Promise<void>;
}

export class NoopUsersStore implements UsersStore {
  readonly enabled = false;
  async upsertByClerkId(_input: UpsertUserInput): Promise<UserRow | null> {
    return null;
  }
  async provisionByClerkId(_input: ProvisionUserInput): Promise<UserRow | null> {
    return null;
  }
  async getByClerkId(_clerkUserId: string): Promise<UserRow | null> {
    return null;
  }
  async dispose(): Promise<void> {}
}

interface UsersRowDb {
  id: string;
  clerk_user_id: string;
  email: string | null;
  display_name: string | null;
  country: string | null;
  default_account_id: string | null;
  created_at: Date;
}

function mapRow(row: UsersRowDb): UserRow {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    email: row.email,
    displayName: row.display_name,
    country: row.country,
    defaultAccountId: row.default_account_id,
    createdAt: row.created_at,
  };
}

export class PostgresUsersStore implements UsersStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresUsersStore {
    return new PostgresUsersStore(
      new Pool({
        connectionString,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000,
        query_timeout: 15_000,
      }),
    );
  }

  async upsertByClerkId(input: UpsertUserInput): Promise<UserRow | null> {
    const id = `usr_${crypto.randomUUID()}`;
    const res = await this.pool.query<UsersRowDb>(
      `INSERT INTO users (id, clerk_user_id, email, display_name, default_account_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET email = COALESCE(EXCLUDED.email, users.email),
             display_name = COALESCE(EXCLUDED.display_name, users.display_name)
       RETURNING id, clerk_user_id, email, display_name, country, default_account_id, created_at`,
      [id, input.clerkUserId, input.email, input.displayName, input.accountId],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async provisionByClerkId(input: ProvisionUserInput): Promise<UserRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.clerkUserId]);
      const existing = await client.query<UsersRowDb>(
        `SELECT id, clerk_user_id, email, display_name, country, default_account_id, created_at
         FROM users WHERE clerk_user_id = $1`,
        [input.clerkUserId],
      );
      const existingRow = existing.rows[0];
      if (existingRow?.default_account_id) {
        const updated = await client.query<UsersRowDb>(
          `UPDATE users
           SET email = COALESCE($2, email),
               display_name = COALESCE($3, display_name)
           WHERE clerk_user_id = $1
           RETURNING id, clerk_user_id, email, display_name, country, default_account_id, created_at`,
          [input.clerkUserId, input.email, input.displayName],
        );
        await client.query('COMMIT');
        return updated.rows[0] ? mapRow(updated.rows[0]) : null;
      }

      await client.query(
        `INSERT INTO paper_accounts (id, label, initial_cash_usd, created_at)
         VALUES ($1, $2, $3, $4)`,
        [input.accountId, input.accountLabel, input.initialCashUsd, input.createdAt],
      );
      await client.query(
        `INSERT INTO paper_cash_ledger (account_id, delta_usd, reason, ref_id, ts)
         VALUES ($1, $2, 'init', NULL, $3)`,
        [input.accountId, input.initialCashUsd, input.createdAt],
      );
      const userId = existingRow?.id ?? `usr_${crypto.randomUUID()}`;
      const provisioned = existingRow
        ? await client.query<UsersRowDb>(
            `UPDATE users
             SET email = COALESCE($2, email),
                 display_name = COALESCE($3, display_name),
                 default_account_id = $4
             WHERE clerk_user_id = $1
             RETURNING id, clerk_user_id, email, display_name, country, default_account_id, created_at`,
            [input.clerkUserId, input.email, input.displayName, input.accountId],
          )
        : await client.query<UsersRowDb>(
            `INSERT INTO users (id, clerk_user_id, email, display_name, default_account_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, clerk_user_id, email, display_name, country, default_account_id, created_at`,
            [userId, input.clerkUserId, input.email, input.displayName, input.accountId],
          );
      await client.query('COMMIT');
      return provisioned.rows[0] ? mapRow(provisioned.rows[0]) : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getByClerkId(clerkUserId: string): Promise<UserRow | null> {
    const res = await this.pool.query<UsersRowDb>(
      `SELECT id, clerk_user_id, email, display_name, country, default_account_id, created_at
       FROM users WHERE clerk_user_id = $1`,
      [clerkUserId],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
