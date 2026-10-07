import { createHash } from 'node:crypto';

import type {
  PortfolioAssistantMemoryCandidateRow,
  PortfolioAssistantUserMemoryStore,
} from '@oggregator/db';

import {
  buildMemoryDistillationInstructions,
  buildMemoryDistillationRequest,
  MEMORY_DISTILLATION_MESSAGE_LIMIT,
  mergeUserMemory,
  parseDistilledMemory,
  parseStoredMemoryItems,
} from './portfolio-assistant-memory.js';
import {
  type PortfolioAssistantModelGateway,
  PortfolioAssistantServiceError,
} from './portfolio-assistant-model-gateway.js';
import type { PortfolioAssistantUsageLimiter } from './portfolio-assistant-usage-limiter.js';
import { beginPortfolioAssistantRuntimeRequest } from './runtime-metrics.js';

export interface MemoryDistillerLog {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface PortfolioAssistantMemoryDistillerOptions {
  featureKey: string;
  maxUsersPerRun: number;
  concurrency: number;
  /** Messages older than this are never distilled, whatever the user's watermark. */
  lookbackMs: number;
}

export type MemoryDistillationOutcome =
  | 'written'
  | 'conflict'
  | 'no_messages'
  | 'busy'
  | 'invalid_response'
  | 'failed'
  | 'not_run';

export interface PortfolioAssistantMemoryDistillationSummary {
  candidates: number;
  outcomes: Record<MemoryDistillationOutcome, number>;
  stoppedReason: string | null;
  durationMs: number;
}

// Hermes being down or out of allowance fails every remaining user the same way.
const RUN_STOPPING_CODES = new Set(['provider_allowance_exhausted', 'provider_unavailable']);

function hashUserId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex');
}

export class PortfolioAssistantMemoryDistiller {
  private readonly abort = new AbortController();
  private running = false;

  constructor(
    private readonly store: PortfolioAssistantUserMemoryStore,
    private readonly gateway: PortfolioAssistantModelGateway,
    private readonly limiter: Pick<
      PortfolioAssistantUsageLimiter,
      'acquirePortfolioAssistantConcurrencyLease'
    >,
    private readonly options: PortfolioAssistantMemoryDistillerOptions,
    private readonly log: MemoryDistillerLog,
    private readonly now: () => number = Date.now,
  ) {}

  dispose(): void {
    this.abort.abort();
  }

  async run(): Promise<PortfolioAssistantMemoryDistillationSummary> {
    const startedAt = this.now();
    const outcomes: Record<MemoryDistillationOutcome, number> = {
      written: 0,
      conflict: 0,
      no_messages: 0,
      busy: 0,
      invalid_response: 0,
      failed: 0,
      not_run: 0,
    };
    if (this.running || !this.store.enabled) {
      return { candidates: 0, outcomes, stoppedReason: 'not_started', durationMs: 0 };
    }
    this.running = true;
    let stoppedReason: string | null = null;
    try {
      const notBefore = new Date(startedAt - this.options.lookbackMs);
      const candidates = await this.store.listMemoryDistillationCandidates({
        notBefore,
        featureKey: this.options.featureKey,
        now: new Date(startedAt),
        limit: this.options.maxUsersPerRun,
      });
      const queue = [...candidates];
      const worker = async () => {
        while (queue.length > 0) {
          const candidate = queue.shift()!;
          if (stoppedReason != null || this.abort.signal.aborted) {
            outcomes.not_run += 1;
            continue;
          }
          try {
            outcomes[await this.distillUser(candidate, notBefore)] += 1;
          } catch (error) {
            const code = error instanceof PortfolioAssistantServiceError ? error.code : null;
            this.log.warn(
              {
                userIdHash: hashUserId(candidate.userId),
                code,
                err: error instanceof Error ? error.message : String(error),
              },
              'portfolio assistant memory distillation failed for user',
            );
            outcomes.failed += 1;
            if (code != null && RUN_STOPPING_CODES.has(code)) stoppedReason = code;
            if (this.abort.signal.aborted) stoppedReason = 'disposed';
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.max(1, Math.min(this.options.concurrency, 2)) }, worker),
      );
      return {
        candidates: candidates.length,
        outcomes,
        stoppedReason,
        durationMs: Math.max(0, this.now() - startedAt),
      };
    } finally {
      this.running = false;
    }
  }

  private async distillUser(
    candidate: PortfolioAssistantMemoryCandidateRow,
    notBefore: Date,
  ): Promise<MemoryDistillationOutcome> {
    const userId = candidate.userId;
    const userIdHash = hashUserId(userId);
    const existingRow = await this.store.loadUserMemory(userId);
    const watermark = existingRow?.lastDistilledAt ?? null;
    const after = watermark != null && watermark > notBefore ? watermark : notBefore;
    const messages = await this.store.listMemoryDistillationMessages({
      userId,
      after,
      limit: MEMORY_DISTILLATION_MESSAGE_LIMIT,
    });
    if (!messages.some((message) => message.role === 'user')) return 'no_messages';

    let release: () => void;
    try {
      // A per-run key keeps the user's own chat unblocked while the batch still counts against
      // the shared Hermes concurrency cap.
      release = this.limiter.acquirePortfolioAssistantConcurrencyLease(
        `memory-distillation:${userId}`,
      );
    } catch (error) {
      if (error instanceof PortfolioAssistantServiceError && error.code === 'concurrent_request') {
        this.log.info({ userIdHash }, 'portfolio assistant memory distillation deferred: busy');
        return 'busy';
      }
      throw error;
    }

    const existing = parseStoredMemoryItems(existingRow?.items ?? []);
    const request = buildMemoryDistillationRequest(existing, messages);
    const releaseMetrics = beginPortfolioAssistantRuntimeRequest();
    let raw = '';
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    try {
      for await (const event of this.gateway.streamPortfolioAnswer(
        {
          threadId: 'memory-distillation',
          systemInstructions: buildMemoryDistillationInstructions(),
          contextMessage: request.contextMessage,
          conversationMessages: request.conversationMessages,
        },
        this.abort.signal,
      )) {
        if (event.type === 'text_delta') raw += event.delta;
        else {
          inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
        }
      }
    } finally {
      releaseMetrics();
      release();
    }

    const parsed = parseDistilledMemory(raw);
    if (!parsed.ok) {
      this.log.warn(
        { userIdHash, reason: parsed.reason, responseChars: raw.length, inputTokens, outputTokens },
        'portfolio assistant memory distillation rejected the model response',
      );
      return 'invalid_response';
    }
    const writtenAt = new Date(this.now());
    const merged = mergeUserMemory(existing, parsed.value, {
      now: writtenAt,
      threadIdsByLabel: request.threadIdsByLabel,
    });
    const newestMessageAt = messages.reduce(
      (latest, message) => (message.createdAt > latest ? message.createdAt : latest),
      after,
    );
    const written = await this.store.replaceUserMemory({
      userId,
      items: merged.items,
      lastDistilledAt: newestMessageAt,
      updatedAt: writtenAt,
      expectedUpdatedAt: existingRow?.updatedAt ?? null,
    });
    this.log.info(
      {
        userIdHash,
        outcome: written ? 'written' : 'conflict',
        messages: messages.length,
        items: merged.items.length,
        added: merged.added,
        removed: merged.removed,
        rejected: merged.rejected,
        inputTokens,
        outputTokens,
      },
      'portfolio assistant memory distilled',
    );
    return written ? 'written' : 'conflict';
  }
}
