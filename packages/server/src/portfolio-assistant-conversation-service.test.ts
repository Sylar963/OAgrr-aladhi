import { logger } from '@oggregator/core';
import type { PortfolioAssistantStore } from '@oggregator/db';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AssistantMcpHandler } from './assistant-market/assistant-mcp-server.js';
import { AssistantRunRegistry } from './assistant-market/assistant-run-registry.js';
import type { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import type { PortfolioAssistantContextBuilder } from './portfolio-assistant-context-builder.js';
import { PortfolioAssistantConversationService } from './portfolio-assistant-conversation-service.js';
import type {
  PortfolioAssistantModelEvent,
  PortfolioAssistantModelGateway,
} from './portfolio-assistant-model-gateway.js';
import type { PortfolioAssistantPromptBuilder } from './portfolio-assistant-prompt-builder.js';
import type { PortfolioAssistantUsageLimiter } from './portfolio-assistant-usage-limiter.js';
import { disposeRuntimeMetrics } from './runtime-metrics.js';
import type { AuthenticatedUser } from './user-service.js';

const REF = 'pref_QUFBQUFBQUFBQUFBQUFBQQ';
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

function buildService(runs: AssistantRunRegistry, mcp: AssistantMcpHandler) {
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
    async *streamPortfolioAnswer(): AsyncIterable<PortfolioAssistantModelEvent> {
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
    { maxContextCharacters: 100_000, model: 'portfolio-chat' } as PortfolioAssistantConfiguration,
    {
      requirePortfolioAssistantEntitlement: async () => undefined,
    } as unknown as PortfolioAssistantAccessService,
    {
      buildPortfolioAssistantContext: async () => ({
        generatedAt: 1,
        positions: [],
        portfolioRef: REF,
      }),
    } as unknown as PortfolioAssistantContextBuilder,
    {
      buildPortfolioAssistantContextMessage: () => 'context',
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
});
