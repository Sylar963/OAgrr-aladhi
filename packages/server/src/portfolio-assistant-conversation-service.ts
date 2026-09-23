import { createHash } from 'node:crypto';

import { logger } from '@oggregator/core';
import type {
  PortfolioAssistantMessageRow,
  PortfolioAssistantStore,
  PortfolioAssistantUsageOutcome,
} from '@oggregator/db';
import {
  type CreatePortfolioAssistantThreadRequest,
  type PortfolioAssistantMessage,
  type PortfolioAssistantMessagePage,
  type PortfolioAssistantStreamEvent,
  type PortfolioAssistantThread,
  PortfolioSourceSchema,
  type SendPortfolioAssistantMessageRequest,
} from '@oggregator/protocol';
import type { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import type { PortfolioAssistantContextBuilder } from './portfolio-assistant-context-builder.js';
import {
  type PortfolioAssistantModelGateway,
  PortfolioAssistantServiceError,
} from './portfolio-assistant-model-gateway.js';
import type { PortfolioAssistantPromptBuilder } from './portfolio-assistant-prompt-builder.js';
import type { PortfolioAssistantUsageLimiter } from './portfolio-assistant-usage-limiter.js';
import {
  beginPortfolioAssistantRuntimeRequest,
  recordPortfolioAssistantRuntimeCompletion,
} from './runtime-metrics.js';
import type { AuthenticatedUser } from './user-service.js';

function mapThread(row: {
  id: string;
  source: string;
  underlying: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}): PortfolioAssistantThread {
  const source = PortfolioSourceSchema.safeParse(row.source);
  if (!source.success) throw new Error('stored portfolio assistant thread has invalid source');
  return {
    threadId: row.id,
    source: source.data,
    underlying: row.underlying,
    title: row.title,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function mapMessage(row: PortfolioAssistantMessageRow): PortfolioAssistantMessage {
  return {
    messageId: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    portfolioGeneratedAt: row.portfolioGeneratedAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
  };
}

interface PortfolioAssistantRunTelemetry {
  requestId: string;
  userIdHash: string;
  source: string;
  underlying: string | null;
  portfolioGeneratedAt: number;
  positionCount: number;
  contextCharacterCount: number;
  historyMessageCount: number;
  startedAtMs: number;
}

export class PortfolioAssistantConversationService {
  constructor(
    private readonly store: PortfolioAssistantStore,
    private readonly configuration: PortfolioAssistantConfiguration,
    private readonly accessService: PortfolioAssistantAccessService,
    private readonly contextBuilder: PortfolioAssistantContextBuilder,
    private readonly promptBuilder: PortfolioAssistantPromptBuilder,
    private readonly gateway: PortfolioAssistantModelGateway,
    private readonly usageLimiter: PortfolioAssistantUsageLimiter,
    private readonly now: () => number = Date.now,
  ) {}

  async createPortfolioAssistantThread(
    user: AuthenticatedUser,
    input: CreatePortfolioAssistantThreadRequest,
  ): Promise<PortfolioAssistantThread> {
    await this.accessService.requirePortfolioAssistantEntitlement(user.id);
    const existing = await this.store.listPortfolioAssistantThreads({
      userId: user.id,
      source: input.source,
      underlying: input.underlying,
      limit: 1,
    });
    if (existing[0]) return mapThread(existing[0]);
    return mapThread(
      await this.store.createPortfolioAssistantThread({
        id: crypto.randomUUID(),
        userId: user.id,
        accountId: user.accountId,
        source: input.source,
        underlying: input.underlying,
        title: input.underlying ? `${input.underlying} portfolio` : 'All portfolio positions',
        createdAt: new Date(this.now()),
      }),
    );
  }

  async listPortfolioAssistantThreads(
    userId: string,
    source: string,
    underlying: string | null,
  ): Promise<PortfolioAssistantThread[]> {
    await this.accessService.requirePortfolioAssistantEntitlement(userId);
    const parsedSource = PortfolioSourceSchema.safeParse(source);
    if (!parsedSource.success)
      throw new PortfolioAssistantServiceError(
        'invalid_query',
        'Invalid portfolio source.',
        400,
        false,
      );
    return (
      await this.store.listPortfolioAssistantThreads({
        userId,
        source: parsedSource.data,
        underlying,
        limit: 20,
      })
    ).map(mapThread);
  }

  async loadPortfolioAssistantMessages(
    userId: string,
    threadId: string,
    cursor?: string,
  ): Promise<PortfolioAssistantMessagePage> {
    await this.accessService.requirePortfolioAssistantEntitlement(userId);
    const thread = await this.store.findOwnedPortfolioAssistantThread(userId, threadId);
    if (!thread)
      throw new PortfolioAssistantServiceError(
        'thread_not_found',
        'Conversation not found.',
        404,
        false,
      );
    const rows = await this.store.listPortfolioAssistantMessages({
      userId,
      threadId,
      ...(cursor ? { cursor } : {}),
      limit: 51,
    });
    const hasMore = rows.length > 50;
    const selected = hasMore ? rows.slice(1) : rows;
    return {
      messages: selected.map(mapMessage),
      nextCursor: hasMore && selected[0] ? String(selected[0].createdAt.getTime()) : null,
    };
  }

  async *streamPortfolioAssistantReply(
    user: AuthenticatedUser,
    threadId: string,
    input: SendPortfolioAssistantMessageRequest,
    signal: AbortSignal,
  ): AsyncIterable<PortfolioAssistantStreamEvent> {
    await this.accessService.requirePortfolioAssistantEntitlement(user.id);
    await this.usageLimiter.requirePortfolioAssistantQuestionAllowance(user.id);
    const release = this.usageLimiter.acquirePortfolioAssistantConcurrencyLease(user.id);
    const startedAt = new Date(this.now());
    let assistantMessageId: string | null = null;
    let accumulated = '';
    let inputTokens: number | null = null;
    let cachedInputTokens: number | null = null;
    let outputTokens: number | null = null;
    let telemetry: PortfolioAssistantRunTelemetry | null = null;
    let releaseRuntimeMetrics: (() => void) | null = null;
    let runOutcome: PortfolioAssistantUsageOutcome | null = null;
    let runErrorCode: string | null = null;
    try {
      const thread = await this.store.findOwnedPortfolioAssistantThread(user.id, threadId);
      if (!thread || thread.accountId !== user.accountId)
        throw new PortfolioAssistantServiceError(
          'thread_not_found',
          'Conversation not found.',
          404,
          false,
        );
      const source = PortfolioSourceSchema.safeParse(thread.source);
      if (!source.success)
        throw new PortfolioAssistantServiceError(
          'context_changed',
          'The conversation portfolio context is invalid.',
          409,
          false,
        );
      const context = await this.contextBuilder.buildPortfolioAssistantContext({
        accountId: user.accountId,
        source: source.data,
        underlying: thread.underlying,
        forwardDays: input.forwardDays,
      });
      const contextMessage = this.promptBuilder.buildPortfolioAssistantContextMessage(context);
      if (contextMessage.length > this.configuration.maxContextCharacters + 1_000) {
        throw new PortfolioAssistantServiceError(
          'portfolio_unavailable',
          'Portfolio context is too large to explain safely.',
          503,
          false,
        );
      }
      const historyPage = await this.loadPortfolioAssistantMessages(user.id, threadId);
      const exchange = await this.store.beginPortfolioAssistantExchange({
        userId: user.id,
        threadId,
        clientMessageId: input.clientMessageId,
        userMessageId: crypto.randomUUID(),
        assistantMessageId: crypto.randomUUID(),
        content: input.message,
        portfolioGeneratedAt: new Date(context.generatedAt),
        contextDigest: createHash('sha256').update(contextMessage).digest('hex'),
        createdAt: startedAt,
      });
      assistantMessageId = exchange.assistantMessage.id;
      yield {
        type: 'message_started',
        assistantMessageId,
        portfolioGeneratedAt: context.generatedAt,
      };
      if (exchange.deduplicated) {
        if (exchange.assistantMessage.content)
          yield {
            type: 'text_delta',
            assistantMessageId,
            delta: exchange.assistantMessage.content,
          };
        yield exchange.assistantMessage.status === 'cancelled'
          ? { type: 'message_cancelled', assistantMessageId }
          : { type: 'message_completed', assistantMessageId };
        return;
      }

      const history = historyPage.messages.filter((message) => message.status !== 'streaming');
      telemetry = {
        requestId: crypto.randomUUID(),
        userIdHash: createHash('sha256').update(user.id).digest('hex'),
        source: source.data,
        underlying: thread.underlying,
        portfolioGeneratedAt: context.generatedAt,
        positionCount: context.positions.length,
        contextCharacterCount: contextMessage.length,
        historyMessageCount: history.length,
        startedAtMs: this.now(),
      };
      releaseRuntimeMetrics = beginPortfolioAssistantRuntimeRequest();
      let lastCheckpoint = this.now();
      for await (const event of this.gateway.streamPortfolioAnswer(
        {
          threadId,
          systemInstructions: this.promptBuilder.buildPortfolioAssistantSystemInstructions(),
          contextMessage,
          conversationMessages: this.promptBuilder.buildPortfolioAssistantConversationMessages(
            history,
            input.message,
          ),
        },
        signal,
      )) {
        if (event.type === 'text_delta') {
          accumulated += event.delta;
          yield { type: 'text_delta', assistantMessageId, delta: event.delta };
          if (this.now() - lastCheckpoint >= 5_000) {
            await this.store.checkpointPortfolioAssistantMessage(assistantMessageId, accumulated);
            lastCheckpoint = this.now();
          }
        } else {
          inputTokens = event.inputTokens;
          cachedInputTokens = event.cachedInputTokens;
          outputTokens = event.outputTokens;
          yield { type: 'usage', inputTokens, cachedInputTokens, outputTokens };
        }
      }
      await this.complete(
        user.id,
        threadId,
        assistantMessageId,
        accumulated,
        'complete',
        'complete',
        startedAt,
        inputTokens,
        cachedInputTokens,
        outputTokens,
      );
      runOutcome = 'complete';
      yield { type: 'message_completed', assistantMessageId };
    } catch (error) {
      if (!assistantMessageId) throw error;
      const serviceError =
        error instanceof PortfolioAssistantServiceError
          ? error
          : new PortfolioAssistantServiceError(
              'internal_error',
              'Portfolio Assistant could not complete the response.',
              500,
              true,
            );
      const cancelled = serviceError.code === 'request_cancelled' || signal.aborted;
      const outcome: PortfolioAssistantUsageOutcome = cancelled
        ? 'cancelled'
        : serviceError.code === 'provider_allowance_exhausted'
          ? 'allowance_exhausted'
          : 'failed';
      runOutcome = outcome;
      runErrorCode = cancelled ? 'request_cancelled' : serviceError.code;
      await this.complete(
        user.id,
        threadId,
        assistantMessageId,
        accumulated,
        cancelled ? 'cancelled' : 'failed',
        outcome,
        startedAt,
        inputTokens,
        cachedInputTokens,
        outputTokens,
      );
      yield cancelled
        ? { type: 'message_cancelled', assistantMessageId }
        : {
            type: 'error',
            code:
              serviceError.code === 'persistence_unavailable' ||
              serviceError.code === 'context_changed' ||
              serviceError.code === 'invalid_body' ||
              serviceError.code === 'invalid_query'
                ? 'internal_error'
                : serviceError.code,
            message: serviceError.message,
            retryable: serviceError.retryable,
          };
    } finally {
      releaseRuntimeMetrics?.();
      if (telemetry && runOutcome) {
        const durationMs = Math.max(0, this.now() - telemetry.startedAtMs);
        recordPortfolioAssistantRuntimeCompletion({
          outcome: runOutcome,
          errorCode: runErrorCode,
          durationMs,
          inputTokens,
          outputTokens,
        });
        logger.info(
          {
            requestId: telemetry.requestId,
            userIdHash: telemetry.userIdHash,
            threadId,
            source: telemetry.source,
            underlying: telemetry.underlying,
            portfolioGeneratedAt: telemetry.portfolioGeneratedAt,
            positionCount: telemetry.positionCount,
            contextCharacterCount: telemetry.contextCharacterCount,
            historyMessageCount: telemetry.historyMessageCount,
            provider: 'hermes',
            model: this.configuration.model,
            inputTokens,
            cachedInputTokens,
            outputTokens,
            durationMs,
            outcome: runOutcome,
            errorCode: runErrorCode,
          },
          'portfolio assistant model run completed',
        );
      }
      release();
    }
  }

  async deletePortfolioAssistantThread(userId: string, threadId: string): Promise<boolean> {
    return this.store.deleteOwnedPortfolioAssistantThread(userId, threadId);
  }

  private async complete(
    userId: string,
    threadId: string,
    assistantMessageId: string,
    content: string,
    status: 'complete' | 'cancelled' | 'failed',
    outcome: PortfolioAssistantUsageOutcome,
    startedAt: Date,
    inputTokens: number | null,
    cachedInputTokens: number | null,
    outputTokens: number | null,
  ): Promise<void> {
    await this.store.completePortfolioAssistantExchange({
      userId,
      threadId,
      assistantMessageId,
      content,
      status,
      provider: 'hermes',
      model: this.configuration.model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      outcome,
      startedAt,
      completedAt: new Date(this.now()),
    });
  }
}
