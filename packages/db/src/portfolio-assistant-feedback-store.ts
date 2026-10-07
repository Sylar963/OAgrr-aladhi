import { Pool, type PoolClient } from 'pg';

export type PortfolioAssistantFeedbackVoteValue = 'up' | 'down';

export interface PortfolioAssistantFeedbackRecord {
  userId: string;
  messageId: string;
  threadId: string;
  vote: PortfolioAssistantFeedbackVoteValue;
  reasons: string[];
  note: string | null;
  /** Privacy-safe run summary (request id, outcome, tool counts); never user content. */
  runTelemetry: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OwnedPortfolioAssistantMessageRow {
  messageId: string;
  threadId: string;
  status: string;
}

export interface PortfolioAssistantFeedbackUpsertResult {
  written: number;
  /** Rows whose message is gone or not owned, or that are older than the stored vote. */
  skipped: number;
}

export interface PortfolioAssistantFeedbackStore {
  readonly enabled: boolean;
  findOwnedAssistantMessage(
    userId: string,
    threadId: string,
    messageId: string,
  ): Promise<OwnedPortfolioAssistantMessageRow | null>;
  findUserFeedback(
    userId: string,
    messageId: string,
  ): Promise<PortfolioAssistantFeedbackRecord | null>;
  listThreadFeedback(userId: string, threadId: string): Promise<PortfolioAssistantFeedbackRecord[]>;
  /** One statement for the whole batch; the newest updatedAt wins per (user, message). */
  upsertFeedback(
    records: PortfolioAssistantFeedbackRecord[],
  ): Promise<PortfolioAssistantFeedbackUpsertResult>;
  dispose(): Promise<void>;
}

export interface PortfolioAssistantFeedbackReportRow extends PortfolioAssistantFeedbackRecord {
  answeredAt: Date | null;
  /** Only filled for down votes. */
  question: string | null;
  answer: string | null;
}

export interface PortfolioAssistantFeedbackExchangeRow {
  userId: string;
  messageId: string;
  threadId: string;
  answeredAt: Date;
  question: string | null;
  answer: string;
}

export interface PortfolioAssistantFeedbackReportSource {
  listFeedbackSince(since: Date): Promise<PortfolioAssistantFeedbackReportRow[]>;
  loadExchanges(
    refs: Array<{ userId: string; messageId: string }>,
  ): Promise<PortfolioAssistantFeedbackExchangeRow[]>;
  dispose(): Promise<void>;
}

interface FeedbackDb {
  user_id: string;
  message_id: string;
  thread_id: string;
  vote: PortfolioAssistantFeedbackVoteValue;
  reasons: string[] | null;
  note: string | null;
  run_telemetry: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

const FEEDBACK_COLUMNS =
  'user_id, message_id, thread_id, vote, reasons, note, run_telemetry, created_at, updated_at';

function mapFeedback(row: FeedbackDb): PortfolioAssistantFeedbackRecord {
  return {
    userId: row.user_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    vote: row.vote,
    reasons: row.reasons ?? [],
    note: row.note,
    runTelemetry: row.run_telemetry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PREVIOUS_QUESTION_JOIN = `LEFT JOIN LATERAL (
  SELECT u.content FROM portfolio_assistant_messages u
  WHERE u.thread_id = m.thread_id AND u.role = 'user' AND u.created_at <= m.created_at
  ORDER BY u.created_at DESC, u.id DESC LIMIT 1
) q ON true`;

export class NoopPortfolioAssistantFeedbackStore implements PortfolioAssistantFeedbackStore {
  readonly enabled = false;
  async findOwnedAssistantMessage(): Promise<null> {
    return null;
  }
  async findUserFeedback(): Promise<null> {
    return null;
  }
  async listThreadFeedback(): Promise<PortfolioAssistantFeedbackRecord[]> {
    return [];
  }
  async upsertFeedback(
    records: PortfolioAssistantFeedbackRecord[],
  ): Promise<PortfolioAssistantFeedbackUpsertResult> {
    return { written: 0, skipped: records.length };
  }
  async dispose(): Promise<void> {}
}

export class PostgresPortfolioAssistantFeedbackStore implements PortfolioAssistantFeedbackStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresPortfolioAssistantFeedbackStore {
    return new PostgresPortfolioAssistantFeedbackStore(
      new Pool({
        connectionString,
        max: 2,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 30_000,
        query_timeout: 30_000,
      }),
    );
  }

  async findOwnedAssistantMessage(
    userId: string,
    threadId: string,
    messageId: string,
  ): Promise<OwnedPortfolioAssistantMessageRow | null> {
    const result = await this.pool.query<{ id: string; thread_id: string; status: string }>(
      `SELECT m.id, m.thread_id, m.status FROM portfolio_assistant_messages m
       JOIN portfolio_assistant_threads t ON t.id = m.thread_id
       WHERE t.user_id = $1 AND t.id = $2 AND m.id = $3 AND m.role = 'assistant'`,
      [userId, threadId, messageId],
    );
    const row = result.rows[0];
    return row ? { messageId: row.id, threadId: row.thread_id, status: row.status } : null;
  }

  async findUserFeedback(
    userId: string,
    messageId: string,
  ): Promise<PortfolioAssistantFeedbackRecord | null> {
    const result = await this.pool.query<FeedbackDb>(
      `SELECT ${FEEDBACK_COLUMNS} FROM portfolio_assistant_feedback
       WHERE user_id = $1 AND message_id = $2`,
      [userId, messageId],
    );
    const row = result.rows[0];
    return row && row.user_id === userId ? mapFeedback(row) : null;
  }

  async listThreadFeedback(
    userId: string,
    threadId: string,
  ): Promise<PortfolioAssistantFeedbackRecord[]> {
    const result = await this.pool.query<FeedbackDb>(
      `SELECT ${FEEDBACK_COLUMNS} FROM portfolio_assistant_feedback
       WHERE user_id = $1 AND thread_id = $2`,
      [userId, threadId],
    );
    return result.rows.filter((row) => row.user_id === userId).map(mapFeedback);
  }

  async upsertFeedback(
    records: PortfolioAssistantFeedbackRecord[],
  ): Promise<PortfolioAssistantFeedbackUpsertResult> {
    if (records.length === 0) return { written: 0, skipped: 0 };
    const payload = JSON.stringify(
      records.map((record) => ({
        user_id: record.userId,
        message_id: record.messageId,
        thread_id: record.threadId,
        vote: record.vote,
        reasons: record.reasons,
        note: record.note,
        run_telemetry: record.runTelemetry,
        created_at: record.createdAt.toISOString(),
        updated_at: record.updatedAt.toISOString(),
      })),
    );
    // The ownership join drops votes whose message was deleted (New chat, retention) or does
    // not belong to the voter, so a stale buffer can never violate the foreign keys.
    const result = await this.pool.query(
      `WITH input AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(
           user_id text, message_id uuid, thread_id uuid, vote text, reasons jsonb, note text,
           run_telemetry jsonb, created_at timestamptz, updated_at timestamptz)
       ), owned AS (
         SELECT i.* FROM input i
         JOIN portfolio_assistant_messages m
           ON m.id = i.message_id AND m.thread_id = i.thread_id AND m.role = 'assistant'
         JOIN portfolio_assistant_threads t ON t.id = m.thread_id AND t.user_id = i.user_id
       )
       INSERT INTO portfolio_assistant_feedback
         (user_id, message_id, thread_id, vote, reasons, note, run_telemetry, created_at, updated_at)
       SELECT user_id, message_id, thread_id, vote,
              ARRAY(SELECT jsonb_array_elements_text(COALESCE(reasons, '[]'::jsonb))),
              note, run_telemetry, created_at, updated_at
       FROM owned
       ON CONFLICT (user_id, message_id) DO UPDATE
       SET vote = EXCLUDED.vote, reasons = EXCLUDED.reasons, note = EXCLUDED.note,
           run_telemetry = COALESCE(EXCLUDED.run_telemetry, portfolio_assistant_feedback.run_telemetry),
           updated_at = EXCLUDED.updated_at
       WHERE portfolio_assistant_feedback.updated_at <= EXCLUDED.updated_at`,
      [payload],
    );
    const written = result.rowCount ?? 0;
    return { written, skipped: records.length - written };
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

/** Owner-only report reader. Every query runs in a READ ONLY transaction. */
export class PostgresPortfolioAssistantFeedbackReportSource
  implements PortfolioAssistantFeedbackReportSource
{
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(
    connectionString: string,
  ): PostgresPortfolioAssistantFeedbackReportSource {
    return new PostgresPortfolioAssistantFeedbackReportSource(
      new Pool({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 60_000,
        query_timeout: 60_000,
      }),
    );
  }

  async listFeedbackSince(since: Date): Promise<PortfolioAssistantFeedbackReportRow[]> {
    return this.readOnly(async (client) => {
      const result = await client.query<
        FeedbackDb & { answered_at: Date | null; question: string | null; answer: string | null }
      >(
        `SELECT ${FEEDBACK_COLUMNS.split(', ')
          .map((column) => `f.${column}`)
          .join(', ')}, m.created_at AS answered_at,
                CASE WHEN f.vote = 'down' THEN q.content END AS question,
                CASE WHEN f.vote = 'down' THEN m.content END AS answer
         FROM portfolio_assistant_feedback f
         JOIN portfolio_assistant_messages m ON m.id = f.message_id
         ${PREVIOUS_QUESTION_JOIN}
         WHERE f.updated_at >= $1
         ORDER BY f.updated_at DESC`,
        [since],
      );
      return result.rows.map((row) => ({
        ...mapFeedback(row),
        answeredAt: row.answered_at,
        question: row.question,
        answer: row.answer,
      }));
    });
  }

  async loadExchanges(
    refs: Array<{ userId: string; messageId: string }>,
  ): Promise<PortfolioAssistantFeedbackExchangeRow[]> {
    if (refs.length === 0) return [];
    return this.readOnly(async (client) => {
      const result = await client.query<{
        user_id: string;
        message_id: string;
        thread_id: string;
        answered_at: Date;
        question: string | null;
        answer: string;
      }>(
        `SELECT r.user_id, m.id AS message_id, m.thread_id, m.created_at AS answered_at,
                q.content AS question, m.content AS answer
         FROM jsonb_to_recordset($1::jsonb) AS r(user_id text, message_id uuid)
         JOIN portfolio_assistant_messages m ON m.id = r.message_id AND m.role = 'assistant'
         JOIN portfolio_assistant_threads t ON t.id = m.thread_id AND t.user_id = r.user_id
         ${PREVIOUS_QUESTION_JOIN}`,
        [JSON.stringify(refs.map((ref) => ({ user_id: ref.userId, message_id: ref.messageId })))],
      );
      return result.rows.map((row) => ({
        userId: row.user_id,
        messageId: row.message_id,
        threadId: row.thread_id,
        answeredAt: row.answered_at,
        question: row.question,
        answer: row.answer,
      }));
    });
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }

  private async readOnly<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
