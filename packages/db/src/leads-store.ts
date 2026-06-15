import { Pool } from 'pg';

export interface LeadRow {
  id: string;
  email: string;
  source: string;
  createdAt: Date;
}

export interface CaptureLeadInput {
  email: string;
  source: string;
}

export interface LeadsStore {
  readonly enabled: boolean;
  /** Insert the lead, or update the source on the existing row keyed by
   * lower(email). Returns the persisted row. */
  captureLead(input: CaptureLeadInput): Promise<LeadRow | null>;
  dispose(): Promise<void>;
}

export class NoopLeadsStore implements LeadsStore {
  readonly enabled = false;
  async captureLead(_input: CaptureLeadInput): Promise<LeadRow | null> {
    return null;
  }
  async dispose(): Promise<void> {}
}

interface LeadsRowDb {
  id: string;
  email: string;
  source: string;
  created_at: Date;
}

function mapRow(row: LeadsRowDb): LeadRow {
  return {
    id: row.id,
    email: row.email,
    source: row.source,
    createdAt: row.created_at,
  };
}

export class PostgresLeadsStore implements LeadsStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresLeadsStore {
    return new PostgresLeadsStore(
      new Pool({
        connectionString,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000,
        query_timeout: 15_000,
      }),
    );
  }

  async captureLead(input: CaptureLeadInput): Promise<LeadRow | null> {
    const id = `lead_${crypto.randomUUID()}`;
    const res = await this.pool.query<LeadsRowDb>(
      `INSERT INTO landing_leads (id, email, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO UPDATE
         SET source = EXCLUDED.source
       RETURNING id, email, source, created_at`,
      [id, input.email, input.source],
    );
    const row = res.rows[0];
    return row ? mapRow(row) : null;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
