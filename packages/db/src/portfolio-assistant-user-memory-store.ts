import { Pool } from 'pg';

export const PORTFOLIO_ASSISTANT_MEMORY_MAX_ITEMS = 12;
export const PORTFOLIO_ASSISTANT_MEMORY_MAX_CONTENT_CHARS = 1_500;

export interface PortfolioAssistantUserMemoryItemRecord {
  id: string;
  text: string;
  category: string;
  sourceThreadId?: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export interface PortfolioAssistantUserMemoryRow {
  userId: string;
  content: string;
  items: PortfolioAssistantUserMemoryItemRecord[];
  lastDistilledAt: Date | null;
  updatedAt: Date;
}

export interface ReplacePortfolioAssistantUserMemoryInput {
  userId: string;
  items: PortfolioAssistantUserMemoryItemRecord[];
  lastDistilledAt: Date;
  updatedAt: Date;
  /** updated_at of the row the caller merged from, or null when there was none. */
  expectedUpdatedAt: Date | null;
}

export interface PortfolioAssistantMemoryCandidateRow {
  userId: string;
  lastDistilledAt: Date | null;
}

export interface ListPortfolioAssistantMemoryCandidatesInput {
  /** Messages at or before this instant are never distilled. */
  notBefore: Date;
  featureKey: string;
  now: Date;
  limit: number;
}

export interface ListPortfolioAssistantMemoryMessagesInput {
  userId: string;
  after: Date;
  limit: number;
}

export interface PortfolioAssistantMemoryMessageRow {
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface PortfolioAssistantUserMemoryStore {
  readonly enabled: boolean;
  loadUserMemory(userId: string): Promise<PortfolioAssistantUserMemoryRow | null>;
  /** Upsert guarded by expectedUpdatedAt; false when the row changed since it was read. */
  replaceUserMemory(input: ReplacePortfolioAssistantUserMemoryInput): Promise<boolean>;
  forgetUserMemory(userId: string, at: Date): Promise<void>;
  deleteUserMemoryItem(userId: string, itemId: string, at: Date): Promise<boolean>;
  listMemoryDistillationCandidates(
    input: ListPortfolioAssistantMemoryCandidatesInput,
  ): Promise<PortfolioAssistantMemoryCandidateRow[]>;
  listMemoryDistillationMessages(
    input: ListPortfolioAssistantMemoryMessagesInput,
  ): Promise<PortfolioAssistantMemoryMessageRow[]>;
  dispose(): Promise<void>;
}

export function renderPortfolioAssistantUserMemoryContent(
  items: Pick<PortfolioAssistantUserMemoryItemRecord, 'category' | 'text'>[],
): string {
  return items.map((item) => `- [${item.category}] ${item.text}`).join('\n');
}

interface MemoryDb {
  user_id: string;
  content: string;
  items: unknown;
  last_distilled_at: Date | null;
  updated_at: Date;
}

function readItems(value: unknown): PortfolioAssistantUserMemoryItemRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PortfolioAssistantUserMemoryItemRecord[] => {
    if (entry == null || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (
      typeof record['id'] !== 'string' ||
      typeof record['text'] !== 'string' ||
      typeof record['category'] !== 'string' ||
      typeof record['updatedAt'] !== 'string'
    ) {
      return [];
    }
    return [
      {
        id: record['id'],
        text: record['text'],
        category: record['category'],
        ...(typeof record['sourceThreadId'] === 'string'
          ? { sourceThreadId: record['sourceThreadId'] }
          : {}),
        updatedAt: record['updatedAt'],
      },
    ];
  });
}

function mapMemory(row: MemoryDb): PortfolioAssistantUserMemoryRow {
  return {
    userId: row.user_id,
    content: row.content,
    items: readItems(row.items),
    lastDistilledAt: row.last_distilled_at,
    updatedAt: row.updated_at,
  };
}

function assertWithinLimits(items: PortfolioAssistantUserMemoryItemRecord[]): string {
  const content = renderPortfolioAssistantUserMemoryContent(items);
  if (
    items.length > PORTFOLIO_ASSISTANT_MEMORY_MAX_ITEMS ||
    content.length > PORTFOLIO_ASSISTANT_MEMORY_MAX_CONTENT_CHARS
  ) {
    throw new Error('portfolio assistant memory exceeds its item or character limit');
  }
  return content;
}

const MEMORY_COLUMNS = 'user_id, content, items, last_distilled_at, updated_at';

export class NoopPortfolioAssistantUserMemoryStore implements PortfolioAssistantUserMemoryStore {
  readonly enabled = false;
  async loadUserMemory(): Promise<null> {
    return null;
  }
  async replaceUserMemory(): Promise<boolean> {
    return false;
  }
  async forgetUserMemory(): Promise<void> {}
  async deleteUserMemoryItem(): Promise<boolean> {
    return false;
  }
  async listMemoryDistillationCandidates(): Promise<PortfolioAssistantMemoryCandidateRow[]> {
    return [];
  }
  async listMemoryDistillationMessages(): Promise<PortfolioAssistantMemoryMessageRow[]> {
    return [];
  }
  async dispose(): Promise<void> {}
}

export class PostgresPortfolioAssistantUserMemoryStore implements PortfolioAssistantUserMemoryStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresPortfolioAssistantUserMemoryStore {
    return new PostgresPortfolioAssistantUserMemoryStore(
      new Pool({
        connectionString,
        max: 2,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000,
        query_timeout: 15_000,
      }),
    );
  }

  async loadUserMemory(userId: string): Promise<PortfolioAssistantUserMemoryRow | null> {
    const result = await this.pool.query<MemoryDb>(
      `SELECT ${MEMORY_COLUMNS} FROM portfolio_assistant_user_memory WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row && row.user_id === userId ? mapMemory(row) : null;
  }

  async replaceUserMemory(input: ReplacePortfolioAssistantUserMemoryInput): Promise<boolean> {
    const content = assertWithinLimits(input.items);
    const result = await this.pool.query(
      `INSERT INTO portfolio_assistant_user_memory (user_id, content, items, last_distilled_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
       SET content = EXCLUDED.content, items = EXCLUDED.items,
           last_distilled_at = EXCLUDED.last_distilled_at, updated_at = EXCLUDED.updated_at
       WHERE portfolio_assistant_user_memory.updated_at IS NOT DISTINCT FROM $6::timestamptz`,
      [
        input.userId,
        content,
        JSON.stringify(input.items),
        input.lastDistilledAt,
        input.updatedAt,
        input.expectedUpdatedAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async forgetUserMemory(userId: string, at: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO portfolio_assistant_user_memory (user_id, content, items, last_distilled_at, updated_at)
       VALUES ($1, '', '[]'::jsonb, $2, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET content = '', items = '[]'::jsonb, updated_at = $2,
           last_distilled_at = GREATEST(portfolio_assistant_user_memory.last_distilled_at, $2)`,
      [userId, at],
    );
  }

  async deleteUserMemoryItem(userId: string, itemId: string, at: Date): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<MemoryDb>(
        `SELECT ${MEMORY_COLUMNS} FROM portfolio_assistant_user_memory WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      const row = current.rows[0];
      const items = row && row.user_id === userId ? readItems(row.items) : [];
      const kept = items.filter((item) => item.id !== itemId);
      if (kept.length === items.length) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `UPDATE portfolio_assistant_user_memory SET content = $2, items = $3::jsonb, updated_at = $4
         WHERE user_id = $1`,
        [userId, renderPortfolioAssistantUserMemoryContent(kept), JSON.stringify(kept), at],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listMemoryDistillationCandidates(
    input: ListPortfolioAssistantMemoryCandidatesInput,
  ): Promise<PortfolioAssistantMemoryCandidateRow[]> {
    const result = await this.pool.query<{ user_id: string; last_distilled_at: Date | null }>(
      `SELECT t.user_id, mem.last_distilled_at, max(m.created_at) AS latest_message_at
       FROM portfolio_assistant_messages m
       JOIN portfolio_assistant_threads t ON t.id = m.thread_id
       JOIN user_entitlements e
         ON e.user_id = t.user_id AND e.feature_key = $3 AND e.status = 'enabled'
        AND (e.expires_at IS NULL OR e.expires_at > $4)
       LEFT JOIN portfolio_assistant_user_memory mem ON mem.user_id = t.user_id
       WHERE m.role = 'assistant' AND m.status = 'complete' AND m.created_at > $1
         AND (mem.last_distilled_at IS NULL OR m.created_at > mem.last_distilled_at)
       GROUP BY t.user_id, mem.last_distilled_at
       ORDER BY mem.last_distilled_at ASC NULLS FIRST, latest_message_at ASC
       LIMIT $2`,
      [input.notBefore, input.limit, input.featureKey, input.now],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      lastDistilledAt: row.last_distilled_at,
    }));
  }

  async listMemoryDistillationMessages(
    input: ListPortfolioAssistantMemoryMessagesInput,
  ): Promise<PortfolioAssistantMemoryMessageRow[]> {
    const result = await this.pool.query<{
      thread_id: string;
      role: 'user' | 'assistant';
      content: string;
      created_at: Date;
    }>(
      `SELECT m.thread_id, m.role, m.content, m.created_at
       FROM portfolio_assistant_messages m
       JOIN portfolio_assistant_threads t ON t.id = m.thread_id
       WHERE t.user_id = $1 AND m.status = 'complete' AND m.created_at > $2
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3`,
      [input.userId, input.after, input.limit],
    );
    return result.rows.reverse().map((row) => ({
      threadId: row.thread_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}
