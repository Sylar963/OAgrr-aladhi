import type {
  PortfolioAssistantFeedbackRecord,
  PortfolioAssistantFeedbackStore,
} from '@oggregator/db';
import {
  type PortfolioAssistantFeedback,
  type PortfolioAssistantFeedbackReason,
  PortfolioAssistantFeedbackReasonSchema,
  type SubmitPortfolioAssistantFeedbackRequest,
  SubmitPortfolioAssistantFeedbackRequestSchema,
} from '@oggregator/protocol';

import type { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import {
  type PortfolioAssistantFeedbackBuffer,
  PortfolioAssistantFeedbackBufferFullError,
} from './portfolio-assistant-feedback-buffer.js';
import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';
import type { PortfolioAssistantRunTelemetryCache } from './portfolio-assistant-run-telemetry.js';
import {
  recordPortfolioAssistantFeedback,
  setPortfolioAssistantFeedbackPending,
} from './runtime-metrics.js';

type FeedbackBuffer = Pick<
  PortfolioAssistantFeedbackBuffer,
  'get' | 'put' | 'listForThread' | 'dropThread' | 'size'
>;

function toFeedback(record: PortfolioAssistantFeedbackRecord): PortfolioAssistantFeedback {
  return {
    messageId: record.messageId,
    vote: record.vote,
    reasons: record.reasons.filter(
      (reason): reason is PortfolioAssistantFeedbackReason =>
        PortfolioAssistantFeedbackReasonSchema.safeParse(reason).success,
    ),
    note: record.note,
    updatedAt: record.updatedAt.getTime(),
  };
}

export class PortfolioAssistantFeedbackService {
  constructor(
    private readonly store: PortfolioAssistantFeedbackStore,
    private readonly buffer: FeedbackBuffer | null,
    private readonly accessService: Pick<
      PortfolioAssistantAccessService,
      'requirePortfolioAssistantEntitlement'
    >,
    private readonly runTelemetry: Pick<PortfolioAssistantRunTelemetryCache, 'get'> | null,
    private readonly now: () => number = Date.now,
  ) {}

  async submitFeedback(
    userId: string,
    threadId: string,
    messageId: string,
    input: SubmitPortfolioAssistantFeedbackRequest,
  ): Promise<PortfolioAssistantFeedback> {
    await this.accessService.requirePortfolioAssistantEntitlement(userId);
    const buffer = this.requireBuffer();
    const request = SubmitPortfolioAssistantFeedbackRequestSchema.parse(input);
    const message = await this.store.findOwnedAssistantMessage(userId, threadId, messageId);
    if (!message) {
      throw new PortfolioAssistantServiceError(
        'thread_not_found',
        'Message not found.',
        404,
        false,
      );
    }
    if (message.status !== 'complete') {
      throw new PortfolioAssistantServiceError(
        'invalid_body',
        'Only completed answers can be rated.',
        409,
        false,
      );
    }

    const previous =
      buffer.get(userId, messageId) ?? (await this.store.findUserFeedback(userId, messageId));
    const at = new Date(this.now());
    const note = request.vote === 'down' ? request.note?.trim() || null : null;
    const record: PortfolioAssistantFeedbackRecord = {
      userId,
      messageId,
      threadId: message.threadId,
      vote: request.vote,
      reasons: request.vote === 'down' ? request.reasons : [],
      note,
      runTelemetry: previous?.runTelemetry ?? this.lookupRunTelemetry(messageId),
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
    };
    try {
      buffer.put(record);
    } catch (error) {
      if (error instanceof PortfolioAssistantFeedbackBufferFullError) {
        throw new PortfolioAssistantServiceError(
          'persistence_unavailable',
          'Feedback cannot be saved right now.',
          503,
          true,
        );
      }
      throw error;
    }
    recordPortfolioAssistantFeedback({
      vote: record.vote,
      reasons: record.reasons,
      previous: previous ? { vote: previous.vote, reasons: previous.reasons } : null,
    });
    setPortfolioAssistantFeedbackPending(buffer.size);
    return toFeedback(record);
  }

  /** The caller's votes in one thread: buffered votes override flushed ones. */
  async listThreadFeedback(
    userId: string,
    threadId: string,
  ): Promise<PortfolioAssistantFeedback[]> {
    await this.accessService.requirePortfolioAssistantEntitlement(userId);
    if (!this.store.enabled) return [];
    const merged = new Map<string, PortfolioAssistantFeedbackRecord>();
    for (const row of await this.store.listThreadFeedback(userId, threadId)) {
      merged.set(row.messageId, row);
    }
    for (const row of this.buffer?.listForThread(userId, threadId) ?? []) {
      const stored = merged.get(row.messageId);
      if (!stored || stored.updatedAt <= row.updatedAt) merged.set(row.messageId, row);
    }
    return [...merged.values()]
      .filter((row) => row.userId === userId)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .map(toFeedback);
  }

  /** Called after the thread is deleted; the database rows go with the cascade. */
  forgetThread(userId: string, threadId: string): void {
    if (!this.buffer) return;
    if (this.buffer.dropThread(userId, threadId) > 0) {
      setPortfolioAssistantFeedbackPending(this.buffer.size);
    }
  }

  private lookupRunTelemetry(messageId: string): Record<string, unknown> | null {
    const summary = this.runTelemetry?.get(messageId);
    return summary ? { ...summary } : null;
  }

  private requireBuffer(): FeedbackBuffer {
    if (!this.store.enabled || !this.buffer) {
      throw new PortfolioAssistantServiceError(
        'persistence_unavailable',
        'Feedback storage is unavailable.',
        503,
        true,
      );
    }
    return this.buffer;
  }
}
