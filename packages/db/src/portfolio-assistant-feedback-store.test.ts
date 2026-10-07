import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  NoopPortfolioAssistantFeedbackStore,
  type PortfolioAssistantFeedbackRecord,
  PostgresPortfolioAssistantFeedbackReportSource,
  PostgresPortfolioAssistantFeedbackStore,
} from './portfolio-assistant-feedback-store.js';

function fakePool(
  respond: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number },
) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
    return respond(sql, params);
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client), end: vi.fn() } as unknown as Pool;
  return { pool, statements, client };
}

const AT = new Date('2026-10-07T12:00:00.000Z');
const vote = (overrides: Partial<PortfolioAssistantFeedbackRecord> = {}) => ({
  userId: 'usr_a',
  messageId: '11111111-1111-4111-8111-111111111111',
  threadId: '22222222-2222-4222-8222-222222222222',
  vote: 'down' as const,
  reasons: ['wrong_numbers'],
  note: 'strike was off',
  runTelemetry: { requestId: 'req-1' },
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});

describe('PostgresPortfolioAssistantFeedbackStore', () => {
  it('writes a whole batch in one ownership-checked, newest-wins statement', async () => {
    const { pool, statements } = fakePool(() => ({ rows: [], rowCount: 1 }));
    const store = new PostgresPortfolioAssistantFeedbackStore(pool);
    const result = await store.upsertFeedback([
      vote(),
      vote({ userId: 'usr_b', messageId: '33333333-3333-4333-8333-333333333333' }),
    ]);

    expect(statements).toHaveLength(1);
    const [{ sql, params }] = statements as [{ sql: string; params: unknown[] }];
    expect(sql).toContain(
      'JOIN portfolio_assistant_threads t ON t.id = m.thread_id AND t.user_id = i.user_id',
    );
    expect(sql).toContain("m.role = 'assistant'");
    expect(sql).toContain('ON CONFLICT (user_id, message_id) DO UPDATE');
    expect(sql).toContain('WHERE portfolio_assistant_feedback.updated_at <= EXCLUDED.updated_at');
    const payload = JSON.parse(params[0] as string) as Array<Record<string, unknown>>;
    expect(payload.map((row) => row['user_id'])).toEqual(['usr_a', 'usr_b']);
    expect(payload[0]).toMatchObject({
      vote: 'down',
      reasons: ['wrong_numbers'],
      note: 'strike was off',
    });
    expect(result).toEqual({ written: 1, skipped: 1 });
  });

  it('skips the database for an empty batch', async () => {
    const { pool, statements } = fakePool(() => ({ rows: [] }));
    expect(await new PostgresPortfolioAssistantFeedbackStore(pool).upsertFeedback([])).toEqual({
      written: 0,
      skipped: 0,
    });
    expect(statements).toHaveLength(0);
  });

  it('scopes message ownership and vote reads to the caller', async () => {
    const { pool, statements } = fakePool((sql) =>
      sql.includes('portfolio_assistant_messages m')
        ? { rows: [{ id: 'm', thread_id: 't', status: 'complete' }] }
        : { rows: [{ ...rowFor('usr_other') }] },
    );
    const store = new PostgresPortfolioAssistantFeedbackStore(pool);
    expect(await store.findOwnedAssistantMessage('usr_a', 't', 'm')).toEqual({
      messageId: 'm',
      threadId: 't',
      status: 'complete',
    });
    expect(statements[0]!.sql).toContain('t.user_id = $1');
    expect(statements[0]!.params).toEqual(['usr_a', 't', 'm']);
    // A row for another user is never returned even if a query misbehaved.
    expect(await store.findUserFeedback('usr_a', 'm')).toBeNull();
    expect(await store.listThreadFeedback('usr_a', 't')).toEqual([]);
  });
});

function rowFor(userId: string) {
  return {
    user_id: userId,
    message_id: 'm',
    thread_id: 't',
    vote: 'up',
    reasons: [],
    note: null,
    run_telemetry: null,
    created_at: AT,
    updated_at: AT,
  };
}

describe('PostgresPortfolioAssistantFeedbackReportSource', () => {
  it('reads inside a READ ONLY transaction and only selects content for down votes', async () => {
    const { pool, statements, client } = fakePool(() => ({
      rows: [{ ...rowFor('usr_a'), vote: 'down', answered_at: AT, question: 'q?', answer: 'a.' }],
    }));
    const source = new PostgresPortfolioAssistantFeedbackReportSource(pool);
    const rows = await source.listFeedbackSince(AT);

    expect(statements.map((statement) => statement.sql.split('\n')[0]!.trim())[0]).toBe(
      'BEGIN TRANSACTION READ ONLY',
    );
    expect(statements[1]!.sql).toContain("CASE WHEN f.vote = 'down' THEN m.content END");
    expect(statements.at(-1)!.sql).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ userId: 'usr_a', question: 'q?', answer: 'a.' });
  });

  it('joins exchanges on the voter so another user cannot be read', async () => {
    const { pool, statements } = fakePool(() => ({ rows: [] }));
    await new PostgresPortfolioAssistantFeedbackReportSource(pool).loadExchanges([
      { userId: 'usr_a', messageId: 'm' },
    ]);
    expect(statements[1]!.sql).toContain('t.user_id = r.user_id');
  });
});

describe('NoopPortfolioAssistantFeedbackStore', () => {
  it('is disabled and writes nothing', async () => {
    const store = new NoopPortfolioAssistantFeedbackStore();
    expect(store.enabled).toBe(false);
    expect(await store.upsertFeedback([vote()])).toEqual({ written: 0, skipped: 1 });
  });
});
