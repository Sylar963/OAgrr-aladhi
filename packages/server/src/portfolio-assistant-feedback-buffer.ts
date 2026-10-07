import type {
  PortfolioAssistantFeedbackRecord,
  PortfolioAssistantFeedbackStore,
  PortfolioAssistantFeedbackUpsertResult,
} from '@oggregator/db';
import { PortfolioAssistantFeedbackReasonSchema } from '@oggregator/protocol';
import { z } from 'zod';

import {
  type DeferredLog,
  FlushSchedule,
  readJsonLines,
  rewriteJsonLines,
} from './deferred-persistence.js';

export interface PortfolioAssistantFeedbackBufferOptions {
  cachePath: string;
  flushIntervalMs: number;
  maxPendingVotes: number;
}

export interface PortfolioAssistantFeedbackFlushResult
  extends PortfolioAssistantFeedbackUpsertResult {
  batch: number;
  pending: number;
}

export class PortfolioAssistantFeedbackBufferFullError extends Error {
  constructor() {
    super('portfolio assistant feedback buffer is full');
    this.name = 'PortfolioAssistantFeedbackBufferFullError';
  }
}

const ReasonSchema = z.enum(PortfolioAssistantFeedbackReasonSchema.options);

const BufferedFeedbackSchema = z
  .object({
    userId: z.string().min(1),
    messageId: z.string().uuid(),
    threadId: z.string().uuid(),
    vote: z.enum(['up', 'down']),
    reasons: z.array(ReasonSchema).max(5),
    note: z.string().max(200).nullable(),
    runTelemetry: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

function decodeFeedback(value: unknown): PortfolioAssistantFeedbackRecord {
  const row = BufferedFeedbackSchema.parse(value);
  return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
}

function encodeFeedback(row: PortfolioAssistantFeedbackRecord): Record<string, unknown> {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Read-only view of the on-disk outbox, for the owner report. */
export function readBufferedPortfolioAssistantFeedback(
  cachePath: string,
  log: DeferredLog,
): PortfolioAssistantFeedbackRecord[] {
  return readJsonLines(cachePath, decodeFeedback, log);
}

function feedbackKey(userId: string, messageId: string): string {
  return `${userId}\u0000${messageId}`;
}

/**
 * Restart-proof outbox for answer votes. Every vote rewrites a small NDJSON file on local disk;
 * the database sees one upsert batch per daily FlushSchedule tick. Within the buffer the latest
 * vote per (user, message) wins.
 */
export class PortfolioAssistantFeedbackBuffer {
  private readonly pending: Map<string, PortfolioAssistantFeedbackRecord>;
  private schedule: FlushSchedule | null = null;
  private flushing = false;

  constructor(
    private readonly delegate: Pick<PortfolioAssistantFeedbackStore, 'upsertFeedback'>,
    private readonly options: PortfolioAssistantFeedbackBufferOptions,
    private readonly log: DeferredLog & { info: (obj: object, msg: string) => void },
  ) {
    this.pending = new Map(
      readJsonLines(options.cachePath, decodeFeedback, log).map((row) => [
        feedbackKey(row.userId, row.messageId),
        row,
      ]),
    );
  }

  /** Starts the daily flush; `onFlushed` sees every completed batch. */
  start(onFlushed: (result: PortfolioAssistantFeedbackFlushResult) => void = () => {}): void {
    if (this.schedule) return;
    this.schedule = new FlushSchedule(
      this.options.cachePath,
      this.options.flushIntervalMs,
      async () => {
        const result = await this.flush();
        onFlushed(result);
        this.log.info(result, 'portfolio assistant feedback flushed');
      },
      (err: unknown) => {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err), pending: this.pending.size },
          'portfolio assistant feedback flush failed',
        );
      },
    );
  }

  get size(): number {
    return this.pending.size;
  }

  get(userId: string, messageId: string): PortfolioAssistantFeedbackRecord | null {
    return this.pending.get(feedbackKey(userId, messageId)) ?? null;
  }

  listForThread(userId: string, threadId: string): PortfolioAssistantFeedbackRecord[] {
    return [...this.pending.values()].filter(
      (row) => row.userId === userId && row.threadId === threadId,
    );
  }

  put(record: PortfolioAssistantFeedbackRecord): void {
    const key = feedbackKey(record.userId, record.messageId);
    if (!this.pending.has(key) && this.pending.size >= this.options.maxPendingVotes) {
      throw new PortfolioAssistantFeedbackBufferFullError();
    }
    this.pending.delete(key);
    this.pending.set(key, record);
    this.persist();
  }

  /** Drops buffered votes for a deleted thread, matching the database cascade. */
  dropThread(userId: string, threadId: string): number {
    let dropped = 0;
    for (const [key, row] of this.pending) {
      if (row.userId === userId && row.threadId === threadId) {
        this.pending.delete(key);
        dropped += 1;
      }
    }
    if (dropped > 0) this.persist();
    return dropped;
  }

  async flush(): Promise<PortfolioAssistantFeedbackFlushResult> {
    if (this.flushing || this.pending.size === 0) {
      return { batch: 0, written: 0, skipped: 0, pending: this.pending.size };
    }
    this.flushing = true;
    const batch = [...this.pending.entries()];
    try {
      const result = await this.delegate.upsertFeedback(batch.map(([, row]) => row));
      // A vote changed while the batch was in flight stays for the next flush.
      for (const [key, row] of batch) {
        if (this.pending.get(key) === row) this.pending.delete(key);
      }
      this.persist();
      return { batch: batch.length, ...result, pending: this.pending.size };
    } finally {
      this.flushing = false;
    }
  }

  /** Votes stay on disk; a restart must not cost a database write. */
  dispose(): void {
    this.schedule?.dispose();
    this.schedule = null;
  }

  private persist(): void {
    rewriteJsonLines(this.options.cachePath, [...this.pending.values()], encodeFeedback);
  }
}
