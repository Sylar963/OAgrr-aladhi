import { logger } from '@oggregator/core';
import { readFileSync } from 'node:fs';
import { AssistantEvalFixtureSchema, fixtureContext } from './assistant-eval/assistant-eval-fixture.js';
import type { PortfolioAssistantStore } from '@oggregator/db';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AssistantMcpHandler } from './assistant-market/assistant-mcp-server.js';
import { AssistantRunRegistry } from './assistant-market/assistant-run-registry.js';
import type {
  StructureSearchPrefetch,
  StructureSearchPrefetchOutcome,
} from './assistant-market/structure-search-prefetch.js';
import type { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import type { PortfolioAssistantContextBuilder } from './portfolio-assistant-context-builder.js';
import { PortfolioAssistantConversationService } from './portfolio-assistant-conversation-service.js';
import type {
  PortfolioAssistantModelEvent,
  PortfolioAssistantModelGateway,
  StreamPortfolioAnswerRequest,
} from './portfolio-assistant-model-gateway.js';
import type { PortfolioAssistantPromptBuilder } from './portfolio-assistant-prompt-builder.js';
import { PortfolioAssistantRunTelemetryCache } from './portfolio-assistant-run-telemetry.js';
import type { PortfolioAssistantUsageLimiter } from './portfolio-assistant-usage-limiter.js';
import { disposeRuntimeMetrics } from './runtime-metrics.js';
import type { AuthenticatedUser } from './user-service.js';

const REF = 'pref_QUFBQUFBQUFBQUFBQUFBQQ';

function testContext() {
  const fixture = AssistantEvalFixtureSchema.parse(JSON.parse(readFileSync(new URL('./assistant-eval/fixtures/reference-max-loss.json', import.meta.url), 'utf8')));
  return { ...fixtureContext(fixture), generatedAt: 1, positions: [], portfolioRef: REF };
}
const USER: AuthenticatedUser = {
  id: 'user-1',
  clerkUserId: 'clerk-1',
  accountId: 'acct-1',
  label: 'u',
};

function messageRow(id: string) {
  return {
    id,
    threadId: 'thread-1',
    clientMessageId: null,
    role: 'assistant' as const,
    content: '',
    status: 'streaming' as const,
    portfolioGeneratedAt: null,
    contextDigest: null,
    createdAt: new Date(0),
    completedAt: null,
  };
}

function buildService(
  runs: AssistantRunRegistry,
  mcp: AssistantMcpHandler,
  runTelemetry: PortfolioAssistantRunTelemetryCache | null = null,
  options: {
    prefetch?: Pick<StructureSearchPrefetch, 'prefetchForQuestion'>;
    contextMessages?: string[];
    maxContextCharacters?: number;
  } = {},
) {
  const store = {
    findOwnedPortfolioAssistantThread: async () => ({
      id: 'thread-1',
      accountId: USER.accountId,
      source: 'thalex',
      underlying: 'BTC',
      title: 'BTC portfolio',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
    listPortfolioAssistantMessages: async () => [],
    beginPortfolioAssistantExchange: async () => ({
      userMessage: messageRow('user-message'),
      assistantMessage: messageRow('assistant-message'),
      deduplicated: false,
    }),
    checkpointPortfolioAssistantMessage: async () => undefined,
    completePortfolioAssistantExchange: async () => undefined,
  };
  const callTool = (name: string, args: Record<string, unknown>) =>
    mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const gateway = {
    async *streamPortfolioAnswer(request: StreamPortfolioAnswerRequest): AsyncIterable<PortfolioAssistantModelEvent> {
      options.contextMessages?.push(request.contextMessage);
      await callTool('test_structure', { portfolioRef: REF });
      await callTool('test_structure', { portfolioRef: REF, legs: 'bad' });
      await callTool('test_market', {});
      yield { type: 'text_delta', delta: 'answer' };
      yield { type: 'usage', inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 };
    },
    checkPortfolioAssistantModelAvailability: async () => 'available' as const,
  };
  return new PortfolioAssistantConversationService(
    store as unknown as PortfolioAssistantStore,
    {
      maxContextCharacters: options.maxContextCharacters ?? 100_000,
      model: 'portfolio-chat',
    } as PortfolioAssistantConfiguration,
    {
      requirePortfolioAssistantEntitlement: async () => undefined,
    } as unknown as PortfolioAssistantAccessService,
    {
      buildPortfolioAssistantContext: async () => testContext(),
    } as unknown as PortfolioAssistantContextBuilder,
    {
      buildPortfolioAssistantContextMessage: (context: Record<string, unknown>) =>
        context['structureSearchFacts'] == null ? 'context' : `context ${'f'.repeat(2_000)}`,
      buildPortfolioAssistantConversationMessages: (_history: unknown, message: string) => [
        { role: 'user', content: message },
      ],
      buildPortfolioAssistantSystemInstructions: () => 'system',
    } as unknown as PortfolioAssistantPromptBuilder,
    gateway as PortfolioAssistantModelGateway,
    {
      requirePortfolioAssistantQuestionAllowance: async () => undefined,
      acquirePortfolioAssistantConcurrencyLease: () => () => undefined,
    } as unknown as PortfolioAssistantUsageLimiter,
    runs,
    null,
    Date.now,
    runTelemetry,
    options.prefetch ?? null,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  disposeRuntimeMetrics();
});

describe('PortfolioAssistantConversationService tool telemetry', () => {
  it('summarizes the MCP tool calls attributed to the run in the completion log', async () => {
    const runs = new AssistantRunRegistry();
    const mcpLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const mcp = new AssistantMcpHandler(
      [
        {
          name: 'test_structure',
          description: 'ref-scoped tool',
          input: z.object({ portfolioRef: z.string(), legs: z.array(z.string()).optional() }),
          run: async () => ({ ok: true }),
        },
        {
          name: 'test_market',
          description: 'market tool',
          input: z.object({}),
          run: async () => ({ ok: true }),
        },
      ],
      mcpLog as unknown as FastifyBaseLogger,
      runs,
    );
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    const events = [];
    for await (const event of buildService(runs, mcp).streamPortfolioAssistantReply(
      USER,
      'thread-1',
      { clientMessageId: 'client-1', message: 'hedge?', forwardDays: 7 },
      new AbortController().signal,
    )) {
      events.push(event.type);
    }

    expect(events.at(-1)).toBe('message_completed');
    const completion = info.mock.calls.find(
      ([, msg]) => msg === 'portfolio assistant model run completed',
    );
    const fields = completion?.[0] as Record<string, unknown>;
    expect(fields['toolCalls']).toEqual({
      total: 3,
      byTool: { test_structure: 2, test_market: 1 },
      failed: 0,
      timedOut: 0,
      rejected: 1,
      exactAttributed: 2,
    });
    const toolLines = [...mcpLog.info.mock.calls, ...mcpLog.warn.mock.calls].map(
      ([line]) => line as Record<string, unknown>,
    );
    expect(toolLines.every((line) => line['requestId'] === fields['requestId'])).toBe(true);
    expect(runs.activeCount).toBe(0);
  });

  it('keeps the run summary per assistant message for answer feedback', async () => {
    const runs = new AssistantRunRegistry();
    const mcp = new AssistantMcpHandler([], {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as FastifyBaseLogger, runs);
    const telemetry = new PortfolioAssistantRunTelemetryCache();
    const service = buildService(runs, mcp, telemetry);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    for await (const _event of service.streamPortfolioAssistantReply(
      USER,
      'thread-1',
      { clientMessageId: 'client-1', message: 'hi', forwardDays: 7 },
      new AbortController().signal,
    ));

    const completion = info.mock.calls.find(
      ([, msg]) => msg === 'portfolio assistant model run completed',
    )?.[0] as Record<string, unknown>;
    const assistantMessageId = completion['assistantMessageId'] as string;
    expect(assistantMessageId).toBeTruthy();
    expect(telemetry.get(assistantMessageId)).toMatchObject({
      requestId: completion['requestId'],
      outcome: 'complete',
      toolCalls: completion['toolCalls'],
    });
  });
});

describe('PortfolioAssistantConversationService user memory', () => {
  it('loads memory for the asking user only and passes it into that request context', async () => {
    const memories: Record<string, { items: Array<{ category: 'venues'; text: string }>; updatedAt: string }> = {
      'user-1': { items: [{ category: 'venues', text: 'Trades on Thalex.' }], updatedAt: 'x' },
      'user-2': { items: [{ category: 'venues', text: 'Trades on Deribit.' }], updatedAt: 'y' },
    };
    const memory = { loadUserMemoryFacts: vi.fn(async (userId: string) => memories[userId] ?? null) };
    const contextInputs: unknown[] = [];
    const service = new PortfolioAssistantConversationService(
      {
        findOwnedPortfolioAssistantThread: async (userId: string) => ({
          id: 'thread-1',
          accountId: userId === 'user-2' ? 'acct-2' : USER.accountId,
          source: 'thalex',
          underlying: 'BTC',
          title: 'BTC portfolio',
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
        listPortfolioAssistantMessages: async () => [],
        beginPortfolioAssistantExchange: async () => ({
          userMessage: messageRow('user-message'),
          assistantMessage: messageRow('assistant-message'),
          deduplicated: false,
        }),
        checkpointPortfolioAssistantMessage: async () => undefined,
        completePortfolioAssistantExchange: async () => undefined,
      } as unknown as PortfolioAssistantStore,
      { maxContextCharacters: 100_000, model: 'portfolio-chat' } as PortfolioAssistantConfiguration,
      {
        requirePortfolioAssistantEntitlement: async () => undefined,
      } as unknown as PortfolioAssistantAccessService,
      {
        buildPortfolioAssistantContext: async (input: unknown) => {
          contextInputs.push(input);
          return testContext();
        },
      } as unknown as PortfolioAssistantContextBuilder,
      {
        buildPortfolioAssistantContextMessage: () => 'context',
        buildPortfolioAssistantConversationMessages: (_history: unknown, message: string) => [
          { role: 'user', content: message },
        ],
        buildPortfolioAssistantSystemInstructions: () => 'system',
      } as unknown as PortfolioAssistantPromptBuilder,
      {
        async *streamPortfolioAnswer(): AsyncIterable<PortfolioAssistantModelEvent> {
          yield { type: 'text_delta', delta: 'answer' };
        },
        checkPortfolioAssistantModelAvailability: async () => 'available' as const,
      },
      {
        requirePortfolioAssistantQuestionAllowance: async () => undefined,
        acquirePortfolioAssistantConcurrencyLease: () => () => undefined,
      } as unknown as PortfolioAssistantUsageLimiter,
      null,
      memory,
    );
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    const ask = async (user: AuthenticatedUser) => {
      for await (const _event of service.streamPortfolioAssistantReply(
        user,
        'thread-1',
        { clientMessageId: crypto.randomUUID(), message: 'hi', forwardDays: 0 },
        new AbortController().signal,
      ));
    };
    await ask(USER);
    await ask({ ...USER, id: 'user-2', accountId: 'acct-2' });

    expect(memory.loadUserMemoryFacts.mock.calls).toEqual([['user-1'], ['user-2']]);
    expect(contextInputs[0]).toMatchObject({ userMemoryFacts: memories['user-1'] });
    expect(contextInputs[1]).toMatchObject({ userMemoryFacts: memories['user-2'] });
    expect(JSON.stringify(contextInputs[0])).not.toContain('Deribit');
    expect(JSON.stringify(contextInputs[1])).not.toContain('Thalex');
  });
});

describe('PortfolioAssistantConversationService structure search prefetch', () => {
  const REQUEST = {
    view: 'bearish' as const,
    viewFrom: 'question' as const,
    maxTotalRiskUsd: 2_200,
    budgetFrom: 'question' as const,
    targetMovePct: null,
    size: 1,
    minDte: 1,
    maxDte: 45,
  };

  function prefetchReturning(outcome: StructureSearchPrefetchOutcome | null) {
    return { prefetchForQuestion: vi.fn(async () => outcome) };
  }

  async function ask(prefetch: ReturnType<typeof prefetchReturning>, maxContextCharacters?: number) {
    const runs = new AssistantRunRegistry();
    const mcp = new AssistantMcpHandler([], { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger, runs);
    const contextMessages: string[] = [];
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const service = buildService(runs, mcp, null, {
      prefetch,
      contextMessages,
      ...(maxContextCharacters == null ? {} : { maxContextCharacters }),
    });
    for await (const _event of service.streamPortfolioAssistantReply(
      USER,
      'thread-1',
      { clientMessageId: 'client-1', message: 'Bearish trade, max loss $2,200', forwardDays: 7 },
      new AbortController().signal,
    ));
    const line = info.mock.calls.findLast(([, msg]) => msg === 'portfolio assistant structure search prefetched')?.[0];
    return { contextMessages, line: line as Record<string, unknown> | undefined };
  }

  it('adds the prefetched search to the context sent to the model', async () => {
    const prefetch = prefetchReturning({
      request: REQUEST,
      facts: { request: REQUEST, result: { candidates: [] } },
      outcome: 'ok',
      code: null,
      durationMs: 12,
    });
    const { contextMessages, line } = await ask(prefetch);
    expect(prefetch.prefetchForQuestion).toHaveBeenCalledWith(
      'Bearish trade, max loss $2,200',
      [],
      expect.objectContaining({ portfolioRef: REF }),
    );
    expect(contextMessages[0]?.startsWith('context f')).toBe(true);
    expect(line).toMatchObject({ outcome: 'ok', included: true, view: 'bearish' });
  });

  it('sends the plain context when the search fails or would exceed the context budget', async () => {
    const failed = await ask(
      prefetchReturning({ request: REQUEST, facts: null, outcome: 'timeout', code: 'timeout', durationMs: 15_000 }),
    );
    expect(failed.contextMessages).toEqual(['context']);
    expect(failed.line).toMatchObject({ outcome: 'timeout', included: false });

    const tooLarge = await ask(
      prefetchReturning({ request: REQUEST, facts: { request: REQUEST, result: {} }, outcome: 'ok', code: null, durationMs: 5 }),
      500,
    );
    expect(tooLarge.contextMessages).toEqual(['context']);
    expect(tooLarge.line).toMatchObject({ outcome: 'ok', included: false });
  });

  it('sends the plain context without a log line when the question is not a constraint question', async () => {
    const { contextMessages, line } = await ask(prefetchReturning(null));
    expect(contextMessages).toEqual(['context']);
    expect(line).toBeUndefined();
  });
});
