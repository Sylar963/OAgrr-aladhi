import { Pool, type PoolClient } from 'pg';

export type VenueEnvironment = 'prod' | 'test';

export interface StoredVenueCredentials {
  accountId: string;
  venue: string;
  /** Defaults to 'prod' on write. */
  environment?: VenueEnvironment;
  encryptedCredentials: string;
}

export interface StoredVenueCredentialSlot {
  accountId: string;
  venue: string;
  environment: VenueEnvironment;
  active: boolean;
  encryptedCredentials: string;
}

export interface VenueCredentialsStore {
  readonly enabled: boolean;
  listVenues(accountId: string): Promise<string[]>;
  /** Every stored environment of one venue. */
  listSlots(accountId: string, venue: string): Promise<StoredVenueCredentialSlot[]>;
  /** The given environment's slot, or the active slot when no environment is given. */
  get(
    accountId: string,
    venue: string,
    environment?: VenueEnvironment,
  ): Promise<StoredVenueCredentialSlot | null>;
  /** Writes the slot and makes it the venue's active one. */
  upsert(credentials: StoredVenueCredentials): Promise<void>;
  /** Makes a stored slot active; false if that slot does not exist. */
  activate(accountId: string, venue: string, environment: VenueEnvironment): Promise<boolean>;
  /** Removes one environment's slot, or every slot of the venue when none is given. */
  delete(accountId: string, venue: string, environment?: VenueEnvironment): Promise<void>;
  /** Every row, for maintenance scripts such as re-encryption. */
  listAll(): Promise<StoredVenueCredentialSlot[]>;
  /** Writes `next` only if the row still holds `expected`; false if it changed meanwhile. */
  replaceEncrypted(
    accountId: string,
    venue: string,
    environment: VenueEnvironment,
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
  async listSlots(_accountId: string, _venue: string): Promise<StoredVenueCredentialSlot[]> {
    return [];
  }
  async get(
    _accountId: string,
    _venue: string,
    _environment?: VenueEnvironment,
  ): Promise<StoredVenueCredentialSlot | null> {
    return null;
  }
  async upsert(_credentials: StoredVenueCredentials): Promise<void> {}
  async activate(
    _accountId: string,
    _venue: string,
    _environment: VenueEnvironment,
  ): Promise<boolean> {
    return false;
  }
  async delete(_accountId: string, _venue: string, _environment?: VenueEnvironment): Promise<void> {}
  async listAll(): Promise<StoredVenueCredentialSlot[]> {
    return [];
  }
  async replaceEncrypted(
    _accountId: string,
    _venue: string,
    _environment: VenueEnvironment,
    _expected: string,
    _next: string,
  ): Promise<boolean> {
    return false;
  }
  async dispose(): Promise<void> {}
}

interface SlotRow {
  account_id: string;
  venue: string;
  environment: VenueEnvironment;
  active: boolean;
  encrypted_credentials: string;
}

const SLOT_COLUMNS = 'account_id, venue, environment, active, encrypted_credentials';

function toSlot(row: SlotRow): StoredVenueCredentialSlot {
  return {
    accountId: row.account_id,
    venue: row.venue,
    environment: row.environment,
    active: row.active,
    encryptedCredentials: row.encrypted_credentials,
  };
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
      `SELECT DISTINCT venue FROM venue_credentials WHERE account_id = $1 ORDER BY venue`,
      [accountId],
    );
    return result.rows.map((row) => row.venue);
  }

  async listSlots(accountId: string, venue: string): Promise<StoredVenueCredentialSlot[]> {
    const result = await this.pool.query<SlotRow>(
      `SELECT ${SLOT_COLUMNS} FROM venue_credentials
       WHERE account_id = $1 AND venue = $2
       ORDER BY environment`,
      [accountId, venue],
    );
    return result.rows.map(toSlot);
  }

  async get(
    accountId: string,
    venue: string,
    environment?: VenueEnvironment,
  ): Promise<StoredVenueCredentialSlot | null> {
    const result =
      environment == null
        ? await this.pool.query<SlotRow>(
            `SELECT ${SLOT_COLUMNS} FROM venue_credentials
             WHERE account_id = $1 AND venue = $2 AND active`,
            [accountId, venue],
          )
        : await this.pool.query<SlotRow>(
            `SELECT ${SLOT_COLUMNS} FROM venue_credentials
             WHERE account_id = $1 AND venue = $2 AND environment = $3`,
            [accountId, venue, environment],
          );
    const row = result.rows[0];
    return row == null ? null : toSlot(row);
  }

  async upsert(credentials: StoredVenueCredentials): Promise<void> {
    const environment = credentials.environment ?? 'prod';
    await this.inTransaction(async (client) => {
      await client.query(
        `UPDATE venue_credentials SET active = false, updated_at = now()
         WHERE account_id = $1 AND venue = $2 AND environment <> $3 AND active`,
        [credentials.accountId, credentials.venue, environment],
      );
      await client.query(
        `INSERT INTO venue_credentials (account_id, venue, environment, active, encrypted_credentials)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (account_id, venue, environment) DO UPDATE
         SET encrypted_credentials = EXCLUDED.encrypted_credentials,
             active = true,
             updated_at = now()`,
        [credentials.accountId, credentials.venue, environment, credentials.encryptedCredentials],
      );
    });
  }

  async activate(accountId: string, venue: string, environment: VenueEnvironment): Promise<boolean> {
    return this.inTransaction(async (client) => {
      const exists = await client.query(
        `SELECT 1 FROM venue_credentials
         WHERE account_id = $1 AND venue = $2 AND environment = $3
         FOR UPDATE`,
        [accountId, venue, environment],
      );
      if (exists.rowCount !== 1) return false;
      await client.query(
        `UPDATE venue_credentials SET active = false, updated_at = now()
         WHERE account_id = $1 AND venue = $2 AND environment <> $3 AND active`,
        [accountId, venue, environment],
      );
      await client.query(
        `UPDATE venue_credentials SET active = true, updated_at = now()
         WHERE account_id = $1 AND venue = $2 AND environment = $3 AND NOT active`,
        [accountId, venue, environment],
      );
      return true;
    });
  }

  async delete(accountId: string, venue: string, environment?: VenueEnvironment): Promise<void> {
    if (environment == null) {
      await this.pool.query(`DELETE FROM venue_credentials WHERE account_id = $1 AND venue = $2`, [
        accountId,
        venue,
      ]);
      return;
    }
    await this.pool.query(
      `DELETE FROM venue_credentials WHERE account_id = $1 AND venue = $2 AND environment = $3`,
      [accountId, venue, environment],
    );
  }

  async listAll(): Promise<StoredVenueCredentialSlot[]> {
    const result = await this.pool.query<SlotRow>(
      `SELECT ${SLOT_COLUMNS} FROM venue_credentials ORDER BY account_id, venue, environment`,
    );
    return result.rows.map(toSlot);
  }

  async replaceEncrypted(
    accountId: string,
    venue: string,
    environment: VenueEnvironment,
    expected: string,
    next: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE venue_credentials
       SET encrypted_credentials = $5, updated_at = now()
       WHERE account_id = $1 AND venue = $2 AND environment = $3 AND encrypted_credentials = $4`,
      [accountId, venue, environment, expected, next],
    );
    return result.rowCount === 1;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
