import { Pool, type PoolClient } from 'pg';

export type UserEntitlementStatus = 'enabled' | 'revoked';
export type PortfolioAssistantMessageRole = 'user' | 'assistant';
export type PortfolioAssistantMessageStatus = 'complete' | 'streaming' | 'cancelled' | 'failed';
export type PortfolioAssistantUsageOutcome =
  | 'complete'
  | 'cancelled'
  | 'failed'
  | 'allowance_exhausted';

export interface UserEntitlementRow {
  userId: string;
  featureKey: string;
  status: UserEntitlementStatus;
  grantedAt: Date;
  expiresAt: Date | null;
}

export interface PortfolioAssistantThreadRow {
  id: string;
  userId: string;
  accountId: string;
  source: string;
  underlying: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PortfolioAssistantMessageRow {
  id: string;
  threadId: string;
  clientMessageId: string | null;
  role: PortfolioAssistantMessageRole;
  content: string;
  status: PortfolioAssistantMessageStatus;
  portfolioGeneratedAt: Date | null;
  contextDigest: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CreatePortfolioAssistantThreadRow {
  id: string;
  userId: string;
  accountId: string;
  source: string;
  underlying: string | null;
  title: string;
  createdAt: Date;
}

export interface ListPortfolioAssistantThreadsInput {
  userId: string;
  source: string;
  underlying: string | null;
  limit: number;
}

export interface ListPortfolioAssistantMessagesInput {
  userId: string;
  threadId: string;
  cursor?: string;
  limit: number;
}

export interface BeginPortfolioAssistantExchangeInput {
  userId: string;
  threadId: string;
  clientMessageId: string;
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  portfolioGeneratedAt: Date;
  contextDigest: string;
  createdAt: Date;
}

export interface BeginPortfolioAssistantExchangeResult {
  userMessage: PortfolioAssistantMessageRow;
  assistantMessage: PortfolioAssistantMessageRow;
  deduplicated: boolean;
}

export interface CompletePortfolioAssistantExchangeInput {
  userId: string;
  threadId: string;
  assistantMessageId: string;
  content: string;
  status: PortfolioAssistantMessageStatus;
  provider: string;
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  outcome: PortfolioAssistantUsageOutcome;
  startedAt: Date;
  completedAt: Date;
}

export interface PortfolioAssistantStore {
  readonly enabled: boolean;
  getUserEntitlement(userId: string, featureKey: string): Promise<UserEntitlementRow | null>;
  redeemFeatureInvite(
    userId: string,
    featureKey: string,
    codeDigest: string,
    redeemedAt: Date,
  ): Promise<'redeemed' | 'already_redeemed' | 'invalid' | 'expired'>;
  createPortfolioAssistantThread(
    input: CreatePortfolioAssistantThreadRow,
  ): Promise<PortfolioAssistantThreadRow>;
  findOwnedPortfolioAssistantThread(
    userId: string,
    threadId: string,
  ): Promise<PortfolioAssistantThreadRow | null>;
  listPortfolioAssistantThreads(
    input: ListPortfolioAssistantThreadsInput,
  ): Promise<PortfolioAssistantThreadRow[]>;
  listPortfolioAssistantMessages(
    input: ListPortfolioAssistantMessagesInput,
  ): Promise<PortfolioAssistantMessageRow[]>;
  beginPortfolioAssistantExchange(
    input: BeginPortfolioAssistantExchangeInput,
  ): Promise<BeginPortfolioAssistantExchangeResult>;
  checkpointPortfolioAssistantMessage(assistantMessageId: string, content: string): Promise<void>;
  completePortfolioAssistantExchange(input: CompletePortfolioAssistantExchangeInput): Promise<void>;
  deleteOwnedPortfolioAssistantThread(userId: string, threadId: string): Promise<boolean>;
  countCompletedPortfolioAssistantQuestionsSince(userId: string, since: Date): Promise<number>;
  deleteExpiredPortfolioAssistantThreads(cutoff: Date, limit: number): Promise<number>;
  dispose(): Promise<void>;
}

interface EntitlementDb {
  user_id: string;
  feature_key: string;
  status: UserEntitlementStatus;
  granted_at: Date;
  expires_at: Date | null;
}
interface ThreadDb {
  id: string;
  user_id: string;
  account_id: string;
  source: string;
  underlying: string | null;
  title: string;
  created_at: Date;
  updated_at: Date;
}
interface MessageDb {
  id: string;
  thread_id: string;
  client_message_id: string | null;
  role: PortfolioAssistantMessageRole;
  content: string;
  status: PortfolioAssistantMessageStatus;
  portfolio_generated_at: Date | null;
  context_digest: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function mapEntitlement(row: EntitlementDb): UserEntitlementRow {
  return {
    userId: row.user_id,
    featureKey: row.feature_key,
    status: row.status,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
  };
}

function mapThread(row: ThreadDb): PortfolioAssistantThreadRow {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    source: row.source,
    underlying: row.underlying,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageDb): PortfolioAssistantMessageRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    clientMessageId: row.client_message_id,
    role: row.role,
    content: row.content,
    status: row.status,
    portfolioGeneratedAt: row.portfolio_generated_at,
    contextDigest: row.context_digest,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

const THREAD_COLUMNS = 'id, user_id, account_id, source, underlying, title, created_at, updated_at';
const MESSAGE_COLUMNS =
  'id, thread_id, client_message_id, role, content, status, portfolio_generated_at, context_digest, created_at, completed_at';

export class NoopPortfolioAssistantStore implements PortfolioAssistantStore {
  readonly enabled = false;
  async getUserEntitlement(_userId: string, _featureKey: string): Promise<null> {
    return null;
  }
  async redeemFeatureInvite(
    _userId: string,
    _featureKey: string,
    _codeDigest: string,
    _redeemedAt: Date,
  ): Promise<'invalid'> {
    return 'invalid';
  }
  async createPortfolioAssistantThread(
    _input: CreatePortfolioAssistantThreadRow,
  ): Promise<PortfolioAssistantThreadRow> {
    throw new Error('portfolio assistant persistence unavailable');
  }
  async findOwnedPortfolioAssistantThread(): Promise<null> {
    return null;
  }
  async listPortfolioAssistantThreads(): Promise<PortfolioAssistantThreadRow[]> {
    return [];
  }
  async listPortfolioAssistantMessages(): Promise<PortfolioAssistantMessageRow[]> {
    return [];
  }
  async beginPortfolioAssistantExchange(): Promise<BeginPortfolioAssistantExchangeResult> {
    throw new Error('portfolio assistant persistence unavailable');
  }
  async checkpointPortfolioAssistantMessage(): Promise<void> {}
  async completePortfolioAssistantExchange(): Promise<void> {}
  async deleteOwnedPortfolioAssistantThread(): Promise<boolean> {
    return false;
  }
  async countCompletedPortfolioAssistantQuestionsSince(): Promise<number> {
    return 0;
  }
  async deleteExpiredPortfolioAssistantThreads(): Promise<number> {
    return 0;
  }
  async dispose(): Promise<void> {}
}

export class PostgresPortfolioAssistantStore implements PortfolioAssistantStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresPortfolioAssistantStore {
    return new PostgresPortfolioAssistantStore(
      new Pool({
        connectionString,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000,
        query_timeout: 15_000,
      }),
    );
  }

  async getUserEntitlement(userId: string, featureKey: string): Promise<UserEntitlementRow | null> {
    const result = await this.pool.query<EntitlementDb>(
      'SELECT user_id, feature_key, status, granted_at, expires_at FROM user_entitlements WHERE user_id = $1 AND feature_key = $2',
      [userId, featureKey],
    );
    return result.rows[0] ? mapEntitlement(result.rows[0]) : null;
  }

  async redeemFeatureInvite(
    userId: string,
    featureKey: string,
    codeDigest: string,
    redeemedAt: Date,
  ): Promise<'redeemed' | 'already_redeemed' | 'invalid' | 'expired'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const invite = await client.query<{
        id: string;
        max_redemptions: number;
        redemption_count: number;
        expires_at: Date | null;
        disabled_at: Date | null;
      }>(
        'SELECT id, max_redemptions, redemption_count, expires_at, disabled_at FROM feature_invites WHERE feature_key = $1 AND code_digest = $2 FOR UPDATE',
        [featureKey, codeDigest],
      );
      const row = invite.rows[0];
      if (!row || row.disabled_at) {
        await client.query('ROLLBACK');
        return 'invalid';
      }
      const prior = await client.query(
        'SELECT 1 FROM feature_invite_redemptions WHERE invite_id = $1 AND user_id = $2',
        [row.id, userId],
      );
      if ((prior.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return 'already_redeemed';
      }
      if (
        (row.expires_at && row.expires_at <= redeemedAt) ||
        row.redemption_count >= row.max_redemptions
      ) {
        await client.query('ROLLBACK');
        return 'expired';
      }
      await client.query(
        'INSERT INTO feature_invite_redemptions (invite_id, user_id, redeemed_at) VALUES ($1, $2, $3)',
        [row.id, userId, redeemedAt],
      );
      await client.query(
        'UPDATE feature_invites SET redemption_count = redemption_count + 1 WHERE id = $1',
        [row.id],
      );
      await client.query(
        `INSERT INTO user_entitlements (user_id, feature_key, status, granted_at, granted_by)
         VALUES ($1, $2, 'enabled', $3, $4)
         ON CONFLICT (user_id, feature_key) DO UPDATE
         SET status = 'enabled', granted_at = EXCLUDED.granted_at, expires_at = NULL, granted_by = EXCLUDED.granted_by`,
        [userId, featureKey, redeemedAt, `invite:${row.id}`],
      );
      await client.query('COMMIT');
      return 'redeemed';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createPortfolioAssistantThread(
    input: CreatePortfolioAssistantThreadRow,
  ): Promise<PortfolioAssistantThreadRow> {
    const result = await this.pool.query<ThreadDb>(
      `INSERT INTO portfolio_assistant_threads (id, user_id, account_id, source, underlying, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING ${THREAD_COLUMNS}`,
      [
        input.id,
        input.userId,
        input.accountId,
        input.source,
        input.underlying,
        input.title,
        input.createdAt,
      ],
    );
    return mapThread(result.rows[0]!);
  }

  async findOwnedPortfolioAssistantThread(
    userId: string,
    threadId: string,
  ): Promise<PortfolioAssistantThreadRow | null> {
    const result = await this.pool.query<ThreadDb>(
      `SELECT ${THREAD_COLUMNS} FROM portfolio_assistant_threads WHERE user_id = $1 AND id = $2`,
      [userId, threadId],
    );
    return result.rows[0] ? mapThread(result.rows[0]) : null;
  }

  async listPortfolioAssistantThreads(
    input: ListPortfolioAssistantThreadsInput,
  ): Promise<PortfolioAssistantThreadRow[]> {
    const result = await this.pool.query<ThreadDb>(
      `SELECT ${THREAD_COLUMNS} FROM portfolio_assistant_threads
       WHERE user_id = $1 AND source = $2 AND underlying IS NOT DISTINCT FROM $3
       ORDER BY updated_at DESC LIMIT $4`,
      [input.userId, input.source, input.underlying, input.limit],
    );
    return result.rows.map(mapThread);
  }

  async listPortfolioAssistantMessages(
    input: ListPortfolioAssistantMessagesInput,
  ): Promise<PortfolioAssistantMessageRow[]> {
    const cursor = input.cursor ? new Date(Number(input.cursor)) : null;
    const result = await this.pool.query<MessageDb>(
      `SELECT m.${MESSAGE_COLUMNS.replaceAll(', ', ', m.')} FROM portfolio_assistant_messages m
       JOIN portfolio_assistant_threads t ON t.id = m.thread_id
       WHERE t.user_id = $1 AND t.id = $2 AND ($3::timestamptz IS NULL OR m.created_at < $3)
       ORDER BY m.created_at DESC, m.id DESC LIMIT $4`,
      [input.userId, input.threadId, cursor, input.limit],
    );
    return result.rows.reverse().map(mapMessage);
  }

  async beginPortfolioAssistantExchange(
    input: BeginPortfolioAssistantExchangeInput,
  ): Promise<BeginPortfolioAssistantExchangeResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<MessageDb>(
        `SELECT ${MESSAGE_COLUMNS} FROM portfolio_assistant_messages WHERE thread_id = $1 AND client_message_id = $2`,
        [input.threadId, input.clientMessageId],
      );
      if (existing.rows[0]) {
        const assistant = await client.query<MessageDb>(
          `SELECT ${MESSAGE_COLUMNS} FROM portfolio_assistant_messages
           WHERE thread_id = $1 AND role = 'assistant' AND created_at >= $2 ORDER BY created_at ASC LIMIT 1`,
          [input.threadId, existing.rows[0].created_at],
        );
        await client.query('COMMIT');
        if (!assistant.rows[0])
          throw new Error('deduplicated exchange is missing assistant message');
        return {
          userMessage: mapMessage(existing.rows[0]),
          assistantMessage: mapMessage(assistant.rows[0]),
          deduplicated: true,
        };
      }
      const userMessage = await this.insertMessage(client, {
        id: input.userMessageId,
        threadId: input.threadId,
        clientMessageId: input.clientMessageId,
        role: 'user',
        content: input.content,
        status: 'complete',
        portfolioGeneratedAt: input.portfolioGeneratedAt,
        contextDigest: input.contextDigest,
        createdAt: input.createdAt,
      });
      const assistantMessage = await this.insertMessage(client, {
        id: input.assistantMessageId,
        threadId: input.threadId,
        clientMessageId: null,
        role: 'assistant',
        content: '',
        status: 'streaming',
        portfolioGeneratedAt: input.portfolioGeneratedAt,
        contextDigest: input.contextDigest,
        createdAt: new Date(input.createdAt.getTime() + 1),
      });
      await client.query('UPDATE portfolio_assistant_threads SET updated_at = $2 WHERE id = $1', [
        input.threadId,
        input.createdAt,
      ]);
      await client.query('COMMIT');
      return { userMessage, assistantMessage, deduplicated: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertMessage(
    client: PoolClient,
    input: {
      id: string;
      threadId: string;
      clientMessageId: string | null;
      role: PortfolioAssistantMessageRole;
      content: string;
      status: PortfolioAssistantMessageStatus;
      portfolioGeneratedAt: Date;
      contextDigest: string;
      createdAt: Date;
    },
  ): Promise<PortfolioAssistantMessageRow> {
    const result = await client.query<MessageDb>(
      `INSERT INTO portfolio_assistant_messages
       (id, thread_id, client_message_id, role, content, status, portfolio_generated_at, context_digest, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${MESSAGE_COLUMNS}`,
      [
        input.id,
        input.threadId,
        input.clientMessageId,
        input.role,
        input.content,
        input.status,
        input.portfolioGeneratedAt,
        input.contextDigest,
        input.createdAt,
      ],
    );
    return mapMessage(result.rows[0]!);
  }

  async checkpointPortfolioAssistantMessage(
    assistantMessageId: string,
    content: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE portfolio_assistant_messages SET content = $2
       WHERE id = $1 AND role = 'assistant' AND status = 'streaming'`,
      [assistantMessageId, content],
    );
  }

  async completePortfolioAssistantExchange(
    input: CompletePortfolioAssistantExchangeInput,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE portfolio_assistant_messages SET content = $2, status = $3, completed_at = $4 WHERE id = $1',
        [input.assistantMessageId, input.content, input.status, input.completedAt],
      );
      await client.query(
        `INSERT INTO portfolio_assistant_usage
         (id, user_id, thread_id, assistant_message_id, provider, model, input_tokens, cached_input_tokens, output_tokens, outcome, started_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          crypto.randomUUID(),
          input.userId,
          input.threadId,
          input.assistantMessageId,
          input.provider,
          input.model,
          input.inputTokens,
          input.cachedInputTokens,
          input.outputTokens,
          input.outcome,
          input.startedAt,
          input.completedAt,
        ],
      );
      await client.query('UPDATE portfolio_assistant_threads SET updated_at = $2 WHERE id = $1', [
        input.threadId,
        input.completedAt,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteOwnedPortfolioAssistantThread(userId: string, threadId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM portfolio_assistant_threads WHERE user_id = $1 AND id = $2',
      [userId, threadId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countCompletedPortfolioAssistantQuestionsSince(
    userId: string,
    since: Date,
  ): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM portfolio_assistant_usage
       WHERE user_id = $1 AND outcome = 'complete' AND completed_at >= $2`,
      [userId, since],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async deleteExpiredPortfolioAssistantThreads(cutoff: Date, limit: number): Promise<number> {
    const result = await this.pool.query(
      `WITH expired AS (
         SELECT id FROM portfolio_assistant_threads WHERE updated_at < $1 ORDER BY updated_at ASC LIMIT $2
       ) DELETE FROM portfolio_assistant_threads WHERE id IN (SELECT id FROM expired)`,
      [cutoff, limit],
    );
    return result.rowCount ?? 0;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
