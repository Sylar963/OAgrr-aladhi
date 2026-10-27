import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { PortfolioAssistantEvidence } from '@oggregator/protocol';

import {
  NoopPortfolioAssistantStore,
  PostgresPortfolioAssistantStore,
} from './portfolio-assistant-store.js';

describe('NoopPortfolioAssistantStore', () => {
  it('fails closed without persistence', async () => {
    const store = new NoopPortfolioAssistantStore();
    expect(store.enabled).toBe(false);
    expect(await store.getUserEntitlement('user', 'portfolio_assistant_beta')).toBeNull();
    expect(
      await store.redeemFeatureInvite('user', 'portfolio_assistant_beta', 'digest', new Date()),
    ).toBe('invalid');
    await expect(
      store.createPortfolioAssistantThread({
        id: crypto.randomUUID(),
        userId: 'user',
        accountId: 'account',
        source: 'manual',
        underlying: null,
        title: 'New chat',
        createdAt: new Date(),
      }),
    ).rejects.toThrow('persistence unavailable');
  });
});

describe('stored assistant evidence', () => {
  it('writes validated evidence only on the assistant row and restores it with saved messages', async () => {
    const evidence: PortfolioAssistantEvidence = {
      version: 1,
      intent: 'exposure',
      contextSections: ['portfolio'],
      relevantLegIds: [],
      assumptions: [],
      gaps: [],
      actions: [],
      comparison: null,
      snapshot: {
        generatedAt: 1,
        source: 'manual',
        underlying: 'BTC',
        network: null,
        forwardDays: 7,
        dataState: 'fresh',
        spotUsd: 80000,
        unrealizedPnlUsd: null,
        netDeltaCoin: null,
        netThetaUsd: null,
        netVegaUsd: null,
        equityUsd: null,
        openLegCount: 0,
        positions: [],
        positionsTruncated: false,
      },
    };
    const row = {
      id: 'assistant',
      thread_id: 'thread',
      client_message_id: null,
      role: 'assistant',
      content: '',
      status: 'streaming',
      portfolio_generated_at: new Date(1),
      context_digest: 'digest',
      created_at: new Date(2),
      completed_at: null,
      evidence,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...row, id: 'user', role: 'user', evidence: null }] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValue({ rows: [] });
    const pool = {
      connect: async () => ({ query, release: vi.fn() }),
      query: vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [row] })),
    };
    const store = new PostgresPortfolioAssistantStore(pool as unknown as Pool);
    const result = await store.beginPortfolioAssistantExchange({
      userId: 'owner',
      threadId: 'thread',
      clientMessageId: 'client',
      userMessageId: 'user',
      assistantMessageId: 'assistant',
      content: 'What is theta?',
      portfolioGeneratedAt: new Date(1),
      contextDigest: 'digest',
      createdAt: new Date(1),
      evidence,
    });
    expect(query.mock.calls[2]?.[1]?.[9]).toBeNull();
    expect(JSON.parse(query.mock.calls[3]?.[1]?.[9] as string)).toEqual(evidence);
    expect(result.assistantMessage.evidence).toEqual(evidence);
    const saved = await store.listPortfolioAssistantMessages({
      userId: 'owner',
      threadId: 'thread',
      limit: 50,
    });
    expect(saved[0]?.evidence).toEqual(evidence);
    expect(pool.query.mock.calls[0]?.[1]).toEqual(['owner', 'thread', null, 50]);
  });
});
