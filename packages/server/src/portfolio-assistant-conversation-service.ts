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
  type PortfolioAssistantProgress,
  PortfolioSourceSchema,
  type SendPortfolioAssistantMessageRequest,
} from '@oggregator/protocol';
import {
  type AssistantRunRegistry,
  type AssistantRunToolSummary,
  emptyAssistantRunToolSummary,
} from './assistant-market/assistant-run-registry.js';
import type { StructureSearchPrefetch } from './assistant-market/structure-search-prefetch.js';
import { planStructureSearchPrefetch } from './assistant-market/structure-search-prefetch.js';
import { buildAssistantEvidence } from './portfolio-assistant-evidence.js';
import { estimateAssistantCost } from './portfolio-assistant-cost.js';
import { relayAssistantEvents } from './portfolio-assistant-progress.js';
import type { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import type {
  PortfolioAssistantContext,
  PortfolioAssistantContextBuilder,
} from './portfolio-assistant-context-builder.js';
import type { PortfolioAssistantMemoryService } from './portfolio-assistant-memory-service.js';
import {
  type PortfolioAssistantModelGateway,
  PortfolioAssistantServiceError,
} from './portfolio-assistant-model-gateway.js';
import type { PortfolioAssistantPromptBuilder } from './portfolio-assistant-prompt-builder.js';
import type { PortfolioAssistantRunTelemetryCache } from './portfolio-assistant-run-telemetry.js';
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
    evidence: row.evidence ?? null,
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
    private readonly runs: AssistantRunRegistry | null = null,
    private readonly memory: Pick<PortfolioAssistantMemoryService, 'loadUserMemoryFacts'> | null = null,
    private readonly now: () => number = Date.now,
    private readonly runTelemetry: Pick<PortfolioAssistantRunTelemetryCache, 'record'> | null = null,
    private readonly structurePrefetch: Pick<StructureSearchPrefetch, 'prefetchForQuestion'> | null = null,
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
    let firstTokenMs: number | null = null;
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
      yield { type: 'progress', stage: 'loading_portfolio' };
      const context = yield* relayAssistantEvents(async (emit) => this.contextBuilder.buildPortfolioAssistantContext({
        accountId: user.accountId,
        source: source.data,
        underlying: thread.underlying,
        forwardDays: input.forwardDays,
        question: input.message,
        onProgress: (stage) => emit({ type: 'progress', stage }),
        userMemoryFacts: (await this.memory?.loadUserMemoryFacts(user.id)) ?? null,
      }));
      const historyPage = await this.loadPortfolioAssistantMessages(user.id, threadId);
      const evidence = buildAssistantEvidence(context, input.message, historyPage.messages);
      context.reviewComparison = evidence.comparison;
      const contextMessage = yield* relayAssistantEvents(async (emit) => this.buildContextMessage(
        context,
        input.message,
        historyPage.messages,
        user.id,
        threadId,
        (stage) => emit({ type: 'progress', stage }),
      ));
      const exchange = await this.store.beginPortfolioAssistantExchange({
        evidence,
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
        portfolioGeneratedAt: exchange.deduplicated
          ? exchange.assistantMessage.portfolioGeneratedAt?.getTime() ?? context.generatedAt : context.generatedAt,
        evidence: exchange.deduplicated ? exchange.assistantMessage.evidence ?? null : evidence,
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

      const conversationMessages = this.promptBuilder.buildPortfolioAssistantConversationMessages(
        historyPage.messages,
        input.message,
        input.locale,
      );
      telemetry = {
        requestId: crypto.randomUUID(),
        userIdHash: createHash('sha256').update(user.id).digest('hex'),
        source: source.data,
        underlying: thread.underlying,
        portfolioGeneratedAt: context.generatedAt,
        positionCount: context.positions.length,
        contextCharacterCount: contextMessage.length,
        historyMessageCount: conversationMessages.length - 1,
        startedAtMs: this.now(),
      };
      let notifyProgress: ((stage: PortfolioAssistantProgress) => void) | null = null;
      this.runs?.begin({
        onToolStart: (tool) => {
          if (/structure|scanner/.test(tool)) notifyProgress?.('evaluating_structures');
          else if (tool === 'search_options_library') notifyProgress?.('searching_books');
          else if (/chain|surface|overview/.test(tool)) notifyProgress?.('checking_quotes');
        },
        requestId: telemetry.requestId,
        userIdHash: telemetry.userIdHash,
        threadId,
        portfolioRef: context.portfolioRef,
      });
      releaseRuntimeMetrics = beginPortfolioAssistantRuntimeRequest();
      yield { type: 'progress', stage: 'writing_answer' };
      let lastCheckpoint = this.now();
      const replyId = assistantMessageId;
      yield* relayAssistantEvents(async (emit) => {
        notifyProgress = (stage) => emit({ type: 'progress', stage });
        try {
      for await (const event of this.gateway.streamPortfolioAnswer(
        {
          threadId,
          systemInstructions: this.promptBuilder.buildPortfolioAssistantSystemInstructions(),
          contextMessage,
          conversationMessages,
        },
        signal,
      )) {
        if (event.type === 'text_delta') {
          if (event.delta.trim() && firstTokenMs == null) firstTokenMs = Math.max(0, this.now() - startedAt.getTime());
          accumulated += event.delta;
          emit({ type: 'text_delta', assistantMessageId: replyId, delta: event.delta });
          if (this.now() - lastCheckpoint >= 5_000) {
            await this.store.checkpointPortfolioAssistantMessage(replyId, accumulated);
            lastCheckpoint = this.now();
          }
        } else {
          inputTokens = event.inputTokens;
          cachedInputTokens = event.cachedInputTokens;
          outputTokens = event.outputTokens;
          emit({ type: 'usage', inputTokens, cachedInputTokens, outputTokens });
        }
      }
        } finally { notifyProgress = null; }
      });
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
        firstTokenMs,
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
        firstTokenMs,
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
      const toolCalls: AssistantRunToolSummary | null = telemetry
        ? (this.runs?.finish(telemetry.requestId) ?? emptyAssistantRunToolSummary())
        : null;
      if (telemetry && runOutcome) {
        const durationMs = Math.max(0, this.now() - telemetry.startedAtMs);
        recordPortfolioAssistantRuntimeCompletion({
          outcome: runOutcome,
          errorCode: runErrorCode,
          durationMs,
          inputTokens,
          outputTokens,
        });
        if (assistantMessageId && toolCalls) {
          this.runTelemetry?.record(assistantMessageId, {
            requestId: telemetry.requestId,
            outcome: runOutcome,
            errorCode: runErrorCode,
            durationMs,
            model: this.configuration.model,
            toolCalls,
            completedAt: this.now(),
          });
        }
        logger.info(
          {
            requestId: telemetry.requestId,
            userIdHash: telemetry.userIdHash,
            threadId,
            assistantMessageId,
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
            firstTokenMs,
            estimatedCostUsd: estimateAssistantCost({ inputTokens, cachedInputTokens, outputTokens }, this.configuration.tokenRates),
            durationMs,
            outcome: runOutcome,
            errorCode: runErrorCode,
            toolCalls,
          },
          'portfolio assistant model run completed',
        );
      }
      release();
    }
  }

  private async buildContextMessage(
    context: PortfolioAssistantContext,
    question: string,
    history: PortfolioAssistantMessage[],
    userId: string,
    threadId: string,
    onProgress?: (stage: PortfolioAssistantProgress) => void,
  ): Promise<string> {
    const limit = this.configuration.maxContextCharacters + 1_000;
    const plain = this.promptBuilder.buildPortfolioAssistantContextMessage(context);
    if (plain.length > limit) {
      throw new PortfolioAssistantServiceError(
        'portfolio_unavailable',
        'Portfolio context is too large to explain safely.',
        503,
        false,
      );
    }
    if (!this.structurePrefetch) return plain;
    const earlierUserMessages = history
      .filter((message) => message.role === 'user' && message.status === 'complete')
      .map((message) => message.content)
      .reverse();
    if (planStructureSearchPrefetch(question, earlierUserMessages, context)) onProgress?.('evaluating_structures');
    const prefetched = await this.structurePrefetch.prefetchForQuestion(question, earlierUserMessages, context);
    if (prefetched === null) return plain;
    const withFacts =
      prefetched.facts === null
        ? null
        : this.promptBuilder.buildPortfolioAssistantContextMessage({
            ...context,
            structureSearchFacts: prefetched.facts,
          });
    const included = withFacts !== null && withFacts.length <= limit;
    logger.info(
      {
        userIdHash: createHash('sha256').update(userId).digest('hex'),
        threadId,
        view: prefetched.request.view,
        viewFrom: prefetched.request.viewFrom,
        budgetFrom: prefetched.request.budgetFrom,
        outcome: prefetched.outcome,
        code: prefetched.code,
        durationMs: prefetched.durationMs,
        included,
        addedCharacters: withFacts === null ? 0 : withFacts.length - plain.length,
      },
      'portfolio assistant structure search prefetched',
    );
    return included ? withFacts : plain;
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
    firstTokenMs: number | null,
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
      firstTokenMs,
      estimatedCostUsd: estimateAssistantCost({ inputTokens, cachedInputTokens, outputTokens }, this.configuration.tokenRates),
      outcome,
      startedAt,
      completedAt: new Date(this.now()),
    });
  }
}
