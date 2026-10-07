import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  NoopPortfolioAssistantUserMemoryStore,
  PostgresPortfolioAssistantUserMemoryStore,
  renderPortfolioAssistantUserMemoryContent,
} from './portfolio-assistant-user-memory-store.js';

interface FakeRow {
  user_id: string;
  content: string;
  items: unknown;
  last_distilled_at: Date | null;
  updated_at: Date;
}

// Answers only the statements the store issues, keyed by the user_id parameter, so a query
// that dropped its user filter would read or write another user's row.
function fakeMemoryTable(seed: FakeRow[]) {
  const rows = new Map(seed.map((row) => [row.user_id, { ...row }]));
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT') && sql.includes('WHERE user_id = $1')) {
      const row = rows.get(params[0] as string);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith('INSERT') && sql.includes('IS NOT DISTINCT FROM')) {
      const [userId, content, items, lastDistilledAt, updatedAt, expected] = params as [
        string,
        string,
        string,
        Date,
        Date,
        Date | null,
      ];
      const existing = rows.get(userId);
      if (existing && existing.updated_at.getTime() !== expected?.getTime()) {
        return { rows: [], rowCount: 0 };
      }
      rows.set(userId, {
        user_id: userId,
        content,
        items: JSON.parse(items),
        last_distilled_at: lastDistilledAt,
        updated_at: updatedAt,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT')) {
      const [userId, at] = params as [string, Date];
      const existing = rows.get(userId);
      const last = existing?.last_distilled_at;
      rows.set(userId, {
        user_id: userId,
        content: '',
        items: [],
        last_distilled_at: last && last > at ? last : at,
        updated_at: at,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE')) {
      const [userId, content, items, at] = params as [string, string, string, Date];
      const existing = rows.get(userId)!;
      rows.set(userId, { ...existing, content, items: JSON.parse(items), updated_at: at });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected statement: ${sql}`);
  });
  const client = { query, release: vi.fn() };
  const pool = { query, connect: vi.fn(async () => client), end: vi.fn() } as unknown as Pool;
  return { pool, rows, statements };
}

const AT = new Date('2026-10-01T00:00:00.000Z');
const item = (id: string, text: string) => ({
  id,
  text,
  category: 'risk_budget',
  updatedAt: AT.toISOString(),
});

function seed() {
  return fakeMemoryTable([
    {
      user_id: 'user-a',
      content: '- [risk_budget] A budget',
      items: [item('mem_a', 'A budget')],
      last_distilled_at: AT,
      updated_at: AT,
    },
    {
      user_id: 'user-b',
      content: '- [risk_budget] B budget',
      items: [item('mem_b', 'B budget')],
      last_distilled_at: AT,
      updated_at: AT,
    },
  ]);
}

describe('PostgresPortfolioAssistantUserMemoryStore user scoping', () => {
  it('loads only the requested user', async () => {
    const { pool } = seed();
    const store = new PostgresPortfolioAssistantUserMemoryStore(pool);
    const a = await store.loadUserMemory('user-a');
    expect(a?.items.map((entry) => entry.text)).toEqual(['A budget']);
    expect(JSON.stringify(a)).not.toContain('B budget');
    expect(await store.loadUserMemory('user-c')).toBeNull();
  });

  it('ignores a row that belongs to another user', async () => {
    const query = vi.fn(async () => ({
      rows: [
        { user_id: 'user-b', content: '', items: [], last_distilled_at: null, updated_at: AT },
      ],
      rowCount: 1,
    }));
    const store = new PostgresPortfolioAssistantUserMemoryStore({ query } as unknown as Pool);
    expect(await store.loadUserMemory('user-a')).toBeNull();
  });

  it('deletes an item only from the owner and never from another user', async () => {
    const { pool, rows } = seed();
    const store = new PostgresPortfolioAssistantUserMemoryStore(pool);
    expect(await store.deleteUserMemoryItem('user-a', 'mem_b', AT)).toBe(false);
    expect(rows.get('user-b')?.items).toHaveLength(1);
    expect(await store.deleteUserMemoryItem('user-a', 'mem_a', new Date(AT.getTime() + 1))).toBe(
      true,
    );
    expect(rows.get('user-a')?.items).toEqual([]);
    expect(rows.get('user-a')?.content).toBe('');
    expect(rows.get('user-b')?.items).toHaveLength(1);
  });

  it('forgets everything for one user and keeps the distillation watermark', async () => {
    const { pool, rows } = seed();
    const store = new PostgresPortfolioAssistantUserMemoryStore(pool);
    const later = new Date(AT.getTime() + 60_000);
    await store.forgetUserMemory('user-a', later);
    expect(rows.get('user-a')).toMatchObject({ items: [], content: '', last_distilled_at: later });
    expect(rows.get('user-b')?.items).toHaveLength(1);
  });

  it('refuses a replace when the row changed since it was read', async () => {
    const { pool, rows } = seed();
    const store = new PostgresPortfolioAssistantUserMemoryStore(pool);
    const replace = (expectedUpdatedAt: Date | null) =>
      store.replaceUserMemory({
        userId: 'user-a',
        items: [item('mem_new', 'New budget')],
        lastDistilledAt: AT,
        updatedAt: new Date(AT.getTime() + 5),
        expectedUpdatedAt,
      });
    expect(await replace(new Date(AT.getTime() - 1))).toBe(false);
    expect(await replace(null)).toBe(false);
    expect(rows.get('user-a')?.items).toEqual([item('mem_a', 'A budget')]);
    expect(await replace(AT)).toBe(true);
    expect(rows.get('user-a')?.content).toBe('- [risk_budget] New budget');
  });

  it('rejects writes beyond the item or character limits', async () => {
    const { pool } = seed();
    const store = new PostgresPortfolioAssistantUserMemoryStore(pool);
    const many = Array.from({ length: 13 }, (_, index) => item(`mem_${index}`, `item ${index}`));
    await expect(
      store.replaceUserMemory({
        userId: 'user-a',
        items: many,
        lastDistilledAt: AT,
        updatedAt: AT,
        expectedUpdatedAt: AT,
      }),
    ).rejects.toThrow('limit');
  });

  it('scopes distillation message reads to one user', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const store = new PostgresPortfolioAssistantUserMemoryStore({ query } as unknown as Pool);
    await store.listMemoryDistillationMessages({ userId: 'user-a', after: AT, limit: 40 });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('t.user_id = $1');
    expect(params).toEqual(['user-a', AT, 40]);
  });
});

describe('NoopPortfolioAssistantUserMemoryStore', () => {
  it('stores and returns nothing', async () => {
    const store = new NoopPortfolioAssistantUserMemoryStore();
    expect(store.enabled).toBe(false);
    expect(await store.loadUserMemory()).toBeNull();
    expect(await store.replaceUserMemory()).toBe(false);
    expect(await store.listMemoryDistillationCandidates()).toEqual([]);
  });
});

describe('renderPortfolioAssistantUserMemoryContent', () => {
  it('renders one labelled line per item', () => {
    expect(
      renderPortfolioAssistantUserMemoryContent([
        { category: 'venues', text: 'Trades on Deribit.' },
        { category: 'goals', text: 'Hedges a long-term BTC holding.' },
      ]),
    ).toBe('- [venues] Trades on Deribit.\n- [goals] Hedges a long-term BTC holding.');
  });
});
