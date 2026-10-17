import { Pool } from 'pg';

export interface StoredVenueCredentials {
  accountId: string;
  venue: string;
  encryptedCredentials: string;
}

export interface VenueCredentialsStore {
  readonly enabled: boolean;
  listVenues(accountId: string): Promise<string[]>;
  get(accountId: string, venue: string): Promise<StoredVenueCredentials | null>;
  upsert(credentials: StoredVenueCredentials): Promise<void>;
  delete(accountId: string, venue: string): Promise<void>;
  /** Every row, for maintenance scripts such as re-encryption. */
  listAll(): Promise<StoredVenueCredentials[]>;
  /** Writes `next` only if the row still holds `expected`; false if it changed meanwhile. */
  replaceEncrypted(
    accountId: string,
    venue: string,
    expected: string,
    next: string,
  ): Promise<boolean>;
  dispose(): Promise<void>;
}

export class NoopVenueCredentialsStore implements VenueCredentialsStore {
  readonly enabled = false;
  async listVenues(_accountId: string): Promise<string[]> {
    return [];
  }
  async get(_accountId: string, _venue: string): Promise<StoredVenueCredentials | null> {
    return null;
  }
  async upsert(_credentials: StoredVenueCredentials): Promise<void> {}
  async delete(_accountId: string, _venue: string): Promise<void> {}
  async listAll(): Promise<StoredVenueCredentials[]> {
    return [];
  }
  async replaceEncrypted(
    _accountId: string,
    _venue: string,
    _expected: string,
    _next: string,
  ): Promise<boolean> {
    return false;
  }
  async dispose(): Promise<void> {}
}

export class PostgresVenueCredentialsStore implements VenueCredentialsStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresVenueCredentialsStore {
    return new PostgresVenueCredentialsStore(
      new Pool({
        connectionString,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000,
        query_timeout: 15_000,
      }),
    );
  }

  async listVenues(accountId: string): Promise<string[]> {
    const result = await this.pool.query<{ venue: string }>(
      `SELECT venue FROM venue_credentials WHERE account_id = $1 ORDER BY venue`,
      [accountId],
    );
    return result.rows.map((row) => row.venue);
  }

  async get(accountId: string, venue: string): Promise<StoredVenueCredentials | null> {
    const result = await this.pool.query<{
      account_id: string;
      venue: string;
      encrypted_credentials: string;
    }>(
      `SELECT account_id, venue, encrypted_credentials
       FROM venue_credentials
       WHERE account_id = $1 AND venue = $2`,
      [accountId, venue],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      accountId: row.account_id,
      venue: row.venue,
      encryptedCredentials: row.encrypted_credentials,
    };
  }

  async upsert(credentials: StoredVenueCredentials): Promise<void> {
    await this.pool.query(
      `INSERT INTO venue_credentials (account_id, venue, encrypted_credentials)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, venue) DO UPDATE
       SET encrypted_credentials = EXCLUDED.encrypted_credentials,
           updated_at = now()`,
      [credentials.accountId, credentials.venue, credentials.encryptedCredentials],
    );
  }

  async delete(accountId: string, venue: string): Promise<void> {
    await this.pool.query(`DELETE FROM venue_credentials WHERE account_id = $1 AND venue = $2`, [
      accountId,
      venue,
    ]);
  }

  async listAll(): Promise<StoredVenueCredentials[]> {
    const result = await this.pool.query<{
      account_id: string;
      venue: string;
      encrypted_credentials: string;
    }>(
      `SELECT account_id, venue, encrypted_credentials
       FROM venue_credentials
       ORDER BY account_id, venue`,
    );
    return result.rows.map((row) => ({
      accountId: row.account_id,
      venue: row.venue,
      encryptedCredentials: row.encrypted_credentials,
    }));
  }

  async replaceEncrypted(
    accountId: string,
    venue: string,
    expected: string,
    next: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE venue_credentials
       SET encrypted_credentials = $4, updated_at = now()
       WHERE account_id = $1 AND venue = $2 AND encrypted_credentials = $3`,
      [accountId, venue, expected, next],
    );
    return result.rowCount === 1;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
