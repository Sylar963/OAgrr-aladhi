import type {
  PortfolioAssistantMemoryMessageRow,
  PortfolioAssistantUserMemoryRow,
  PortfolioAssistantUserMemoryStore,
  ReplacePortfolioAssistantUserMemoryInput,
} from '@oggregator/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import { PortfolioAssistantMemoryDistiller } from './portfolio-assistant-memory-distiller.js';
import {
  type PortfolioAssistantModelEvent,
  type PortfolioAssistantModelGateway,
  PortfolioAssistantServiceError,
  type StreamPortfolioAnswerRequest,
} from './portfolio-assistant-model-gateway.js';
import { PortfolioAssistantUsageLimiter } from './portfolio-assistant-usage-limiter.js';
import { disposeRuntimeMetrics } from './runtime-metrics.js';

const NOW = Date.parse('2026-10-07T03:00:00.000Z');
const THREAD = '6f1c1d38-2a4c-4b8e-9b77-0f5d7f0e9a11';

function message(
  role: 'user' | 'assistant',
  content: string,
  minutesAgo: number,
): PortfolioAssistantMemoryMessageRow {
  return { threadId: THREAD, role, content, createdAt: new Date(NOW - minutesAgo * 60_000) };
}

function fakeStore(
  users: Record<string, { memory?: PortfolioAssistantUserMemoryRow; messages: PortfolioAssistantMemoryMessageRow[] }>,
) {
  const writes: ReplacePortfolioAssistantUserMemoryInput[] = [];
  const store: PortfolioAssistantUserMemoryStore = {
    enabled: true,
    loadUserMemory: async (userId) => users[userId]?.memory ?? null,
    replaceUserMemory: async (input) => {
      writes.push(input);
      return true;
    },
    forgetUserMemory: async () => undefined,
    deleteUserMemoryItem: async () => false,
    listMemoryDistillationCandidates: async ({ limit }) =>
      Object.keys(users)
        .slice(0, limit)
        .map((userId) => ({ userId, lastDistilledAt: users[userId]?.memory?.lastDistilledAt ?? null })),
    listMemoryDistillationMessages: async ({ userId }) => users[userId]?.messages ?? [],
    dispose: async () => undefined,
  };
  return { store, writes };
}

function gatewayReplying(
  reply: (request: StreamPortfolioAnswerRequest) => string | Error,
): PortfolioAssistantModelGateway & { requests: StreamPortfolioAnswerRequest[] } {
  const requests: StreamPortfolioAnswerRequest[] = [];
  return {
    requests,
    async *streamPortfolioAnswer(request): AsyncIterable<PortfolioAssistantModelEvent> {
      requests.push(request);
      const result = reply(request);
      if (result instanceof Error) throw result;
      yield { type: 'text_delta', delta: result };
      yield { type: 'usage', inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 };
    },
    checkPortfolioAssistantModelAvailability: async () => 'available',
  };
}

const limiter = () =>
  new PortfolioAssistantUsageLimiter(
    {} as never,
    { maxConcurrentRequests: 4 } as PortfolioAssistantConfiguration,
  );
const log = () => ({ info: vi.fn(), warn: vi.fn() });
const OPTIONS = {
  featureKey: 'portfolio_assistant_beta',
  maxUsersPerRun: 25,
  concurrency: 2,
  lookbackMs: 7 * 24 * 60 * 60_000,
};

afterEach(() => disposeRuntimeMetrics());

describe('PortfolioAssistantMemoryDistiller', () => {
  it('writes once per user, isolates failures and never mixes users', async () => {
    const { store, writes } = fakeStore({
      'user-a': { messages: [message('user', 'Remember: max loss per trade is $2,000', 30)] },
      'user-b': { messages: [message('user', 'I only trade on Thalex', 20)] },
      'user-c': { messages: [message('user', 'Explain like I am new', 10)] },
    });
    const gateway = gatewayReplying((request) => {
      if (request.contextMessage.includes('$2,000'))
        return '{"items":[{"category":"risk_budget","text":"Max loss per trade is $2,000.","source":"T1"}]}';
      if (request.contextMessage.includes('Thalex'))
        return '{"items":[{"category":"venues","text":"Trades only on Thalex.","source":"T1"}]}';
      return new Error('model crashed');
    });
    const logger = log();
    const summary = await new PortfolioAssistantMemoryDistiller(
      store,
      gateway,
      limiter(),
      OPTIONS,
      logger,
      () => NOW,
    ).run();

    expect(summary.outcomes).toMatchObject({ written: 2, failed: 1 });
    expect(writes.map((write) => write.userId).sort()).toEqual(['user-a', 'user-b']);
    const a = writes.find((write) => write.userId === 'user-a')!;
    expect(a.items.map((item) => item.text)).toEqual(['Max loss per trade is $2,000.']);
    expect(a.items[0]?.sourceThreadId).toBe(THREAD);
    expect(a.lastDistilledAt).toEqual(new Date(NOW - 30 * 60_000));
    expect(a.expectedUpdatedAt).toBeNull();
    expect(JSON.stringify(writes.find((write) => write.userId === 'user-b'))).not.toContain(
      '2,000',
    );
    expect(gateway.requests.every((request) => request.systemInstructions.includes('Do not call any tools'))).toBe(true);
    expect(gateway.requests.every((request) => !request.contextMessage.includes('portfolio_context'))).toBe(true);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Thalex');
  });

  it('does not write when the model reply fails validation', async () => {
    const { store, writes } = fakeStore({
      'user-a': { messages: [message('user', 'hello', 5)] },
    });
    const logger = log();
    const summary = await new PortfolioAssistantMemoryDistiller(
      store,
      gatewayReplying(() => 'Sure! The user likes spreads.'),
      limiter(),
      OPTIONS,
      logger,
      () => NOW,
    ).run();
    expect(summary.outcomes.invalid_response).toBe(1);
    expect(writes).toEqual([]);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({ reason: 'empty' });
  });

  it('merges with existing memory and guards the write with the row version it read', async () => {
    const updatedAt = new Date(NOW - 86_400_000);
    const { store, writes } = fakeStore({
      'user-a': {
        memory: {
          userId: 'user-a',
          content: '',
          items: [
            {
              id: 'mem_aaaa',
              text: 'Max loss per trade is $1,000.',
              category: 'risk_budget',
              updatedAt: updatedAt.toISOString(),
            },
          ],
          lastDistilledAt: updatedAt,
          updatedAt,
        },
        messages: [message('user', 'Raise my max loss to 1500', 5)],
      },
    });
    await new PortfolioAssistantMemoryDistiller(
      store,
      gatewayReplying(
        () =>
          '{"items":[{"category":"risk_budget","text":"Max loss per trade is $1,500.","replaces":"mem_aaaa"}],"forget":[]}',
      ),
      limiter(),
      OPTIONS,
      log(),
      () => NOW,
    ).run();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.items.map((item) => item.text)).toEqual(['Max loss per trade is $1,500.']);
    expect(writes[0]?.expectedUpdatedAt).toEqual(updatedAt);
  });

  it('stops the run when the shared allowance is exhausted', async () => {
    const { store, writes } = fakeStore({
      'user-a': { messages: [message('user', 'a', 3)] },
      'user-b': { messages: [message('user', 'b', 2)] },
      'user-c': { messages: [message('user', 'c', 1)] },
    });
    const gateway = gatewayReplying(
      () =>
        new PortfolioAssistantServiceError(
          'provider_allowance_exhausted',
          'exhausted',
          503,
          false,
        ),
    );
    const summary = await new PortfolioAssistantMemoryDistiller(
      store,
      gateway,
      limiter(),
      { ...OPTIONS, concurrency: 1 },
      log(),
      () => NOW,
    ).run();
    expect(summary.stoppedReason).toBe('provider_allowance_exhausted');
    expect(summary.outcomes).toMatchObject({ failed: 1, not_run: 2 });
    expect(gateway.requests).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it('defers a user when the shared Hermes concurrency cap is full', async () => {
    const { store, writes } = fakeStore({
      'user-a': { messages: [message('user', 'a', 3)] },
    });
    const busy = limiter();
    for (let index = 0; index < 4; index += 1) busy.acquirePortfolioAssistantConcurrencyLease(`chat-${index}`);
    const summary = await new PortfolioAssistantMemoryDistiller(
      store,
      gatewayReplying(() => '{"items":[]}'),
      busy,
      OPTIONS,
      log(),
      () => NOW,
    ).run();
    expect(summary.outcomes.busy).toBe(1);
    expect(writes).toEqual([]);
  });

  it('skips users with only assistant messages and honours the per-run cap', async () => {
    const { store, writes } = fakeStore({
      'user-a': { messages: [message('assistant', 'answer', 3)] },
      'user-b': { messages: [message('user', 'b', 2)] },
    });
    const summary = await new PortfolioAssistantMemoryDistiller(
      store,
      gatewayReplying(() => '{"items":[]}'),
      limiter(),
      { ...OPTIONS, maxUsersPerRun: 1 },
      log(),
      () => NOW,
    ).run();
    expect(summary.candidates).toBe(1);
    expect(summary.outcomes.no_messages).toBe(1);
    expect(writes).toEqual([]);
  });
});
