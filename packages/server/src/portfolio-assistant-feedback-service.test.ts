import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  PortfolioAssistantFeedbackRecord,
  PortfolioAssistantFeedbackStore,
} from '@oggregator/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyAssistantRunToolSummary } from './assistant-market/assistant-run-registry.js';
import { PortfolioAssistantFeedbackBuffer } from './portfolio-assistant-feedback-buffer.js';
import { PortfolioAssistantFeedbackService } from './portfolio-assistant-feedback-service.js';
import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';
import { PortfolioAssistantRunTelemetryCache } from './portfolio-assistant-run-telemetry.js';
import { disposeRuntimeMetrics, getRuntimeMetricsSnapshot } from './runtime-metrics.js';

const THREAD = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '11111111-1111-4111-8111-111111111111';
const STREAMING = '33333333-3333-4333-8333-333333333333';

// Alice owns THREAD with one complete and one streaming answer; Bob owns nothing.
function fakeStore(flushed: PortfolioAssistantFeedbackRecord[] = []) {
  return {
    enabled: true,
    findOwnedAssistantMessage: vi.fn(
      async (userId: string, threadId: string, messageId: string) => {
        if (userId !== 'usr_alice' || threadId !== THREAD) return null;
        if (messageId === MESSAGE) return { messageId, threadId, status: 'complete' };
        if (messageId === STREAMING) return { messageId, threadId, status: 'streaming' };
        return null;
      },
    ),
    findUserFeedback: vi.fn(
      async (userId: string, messageId: string) =>
        flushed.find((row) => row.userId === userId && row.messageId === messageId) ?? null,
    ),
    listThreadFeedback: vi.fn(async (userId: string, threadId: string) =>
      flushed.filter((row) => row.userId === userId && row.threadId === threadId),
    ),
    upsertFeedback: vi.fn(async (rows: PortfolioAssistantFeedbackRecord[]) => ({
      written: rows.length,
      skipped: 0,
    })),
    dispose: vi.fn(async () => undefined),
  } satisfies PortfolioAssistantFeedbackStore;
}

describe('PortfolioAssistantFeedbackService', () => {
  let directory: string;
  let now: number;
  let buffer: PortfolioAssistantFeedbackBuffer;
  let store: ReturnType<typeof fakeStore>;
  let telemetry: PortfolioAssistantRunTelemetryCache;
  let entitlement: ReturnType<typeof vi.fn>;
  let service: PortfolioAssistantFeedbackService;

  function build(flushed: PortfolioAssistantFeedbackRecord[] = []) {
    store = fakeStore(flushed);
    buffer = new PortfolioAssistantFeedbackBuffer(
      store,
      { cachePath: join(directory, 'feedback.ndjson'), flushIntervalMs: 1, maxPendingVotes: 100 },
      { warn: vi.fn(), info: vi.fn() },
    );
    service = new PortfolioAssistantFeedbackService(
      store,
      buffer,
      { requirePortfolioAssistantEntitlement: entitlement },
      telemetry,
      () => now,
    );
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ogg-feedback-service-'));
    now = Date.parse('2026-10-07T12:00:00.000Z');
    telemetry = new PortfolioAssistantRunTelemetryCache({ now: () => now });
    entitlement = vi.fn(async () => undefined);
    disposeRuntimeMetrics();
    build();
  });

  afterEach(() => {
    buffer.dispose();
    disposeRuntimeMetrics();
    rmSync(directory, { recursive: true, force: true });
  });

  it('records a vote on the caller own completed answer without touching the database', async () => {
    const saved = await service.submitFeedback('usr_alice', THREAD, MESSAGE, {
      vote: 'down',
      reasons: ['wrong_numbers', 'too_long'],
      note: '  strike is wrong  ',
    });
    expect(saved).toEqual({
      messageId: MESSAGE,
      vote: 'down',
      reasons: ['wrong_numbers', 'too_long'],
      note: 'strike is wrong',
      updatedAt: now,
    });
    expect(store.upsertFeedback).not.toHaveBeenCalled();
    expect(buffer.size).toBe(1);
  });

  it("rejects another user's message as not found", async () => {
    await expect(
      service.submitFeedback('usr_bob', THREAD, MESSAGE, { vote: 'up' }),
    ).rejects.toMatchObject({ code: 'thread_not_found', statusCode: 404 });
    expect(buffer.size).toBe(0);
  });

  it('rejects an answer that is still streaming', async () => {
    await expect(
      service.submitFeedback('usr_alice', THREAD, STREAMING, { vote: 'up' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('requires the entitlement', async () => {
    entitlement.mockRejectedValue(
      new PortfolioAssistantServiceError('assistant_not_enabled', 'No.', 403, false),
    );
    await expect(
      service.submitFeedback('usr_alice', THREAD, MESSAGE, { vote: 'up' }),
    ).rejects.toMatchObject({ code: 'assistant_not_enabled' });
    expect(store.findOwnedAssistantMessage).not.toHaveBeenCalled();
  });

  it('lets the latest vote win, keeps the first createdAt and counts a change once', async () => {
    await service.submitFeedback('usr_alice', THREAD, MESSAGE, { vote: 'up' });
    const firstAt = now;
    now += 60_000;
    await service.submitFeedback('usr_alice', THREAD, MESSAGE, { vote: 'down' });
    now += 60_000;
    await service.submitFeedback('usr_alice', THREAD, MESSAGE, {
      vote: 'down',
      reasons: ['refused'],
    });

    expect(buffer.get('usr_alice', MESSAGE)).toMatchObject({
      vote: 'down',
      reasons: ['refused'],
      createdAt: new Date(firstAt),
      updatedAt: new Date(now),
    });
    expect(getRuntimeMetricsSnapshot().portfolioAssistant.feedback).toEqual({
      votesTotal: { up: 1, down: 1 },
      downReasonsTotal: { refused: 1 },
      changedTotal: 1,
      pendingVotes: 1,
      flushedTotal: 0,
      flushSkippedTotal: 0,
    });
  });

  it('carries the run telemetry summary of the rated answer', async () => {
    telemetry.record(MESSAGE, {
      requestId: 'req-1',
      outcome: 'complete',
      errorCode: null,
      durationMs: 1_234,
      model: 'portfolio-chat',
      toolCalls: { ...emptyAssistantRunToolSummary(), total: 2, byTool: { option_chain: 2 } },
      completedAt: now,
    });
    await service.submitFeedback('usr_alice', THREAD, MESSAGE, { vote: 'down' });
    expect(buffer.get('usr_alice', MESSAGE)?.runTelemetry).toMatchObject({
      requestId: 'req-1',
      toolCalls: { total: 2, byTool: { option_chain: 2 } },
    });
  });

  it('lists flushed and buffered votes with the newer one winning', async () => {
    build([
      {
        userId: 'usr_alice',
        messageId: MESSAGE,
        threadId: THREAD,
        vote: 'up',
        reasons: [],
        note: null,
        runTelemetry: null,
        createdAt: new Date(now - 10_000),
        updatedAt: new Date(now - 10_000),
      },
    ]);
    expect(await service.listThreadFeedback('usr_alice', THREAD)).toMatchObject([{ vote: 'up' }]);
    await service.submitFeedback('usr_alice', THREAD, MESSAGE, { vote: 'down' });
    expect(await service.listThreadFeedback('usr_alice', THREAD)).toMatchObject([
      { messageId: MESSAGE, vote: 'down' },
    ]);
    expect(await service.listThreadFeedback('usr_bob', THREAD)).toEqual([]);
  });

  it('forgets buffered votes of a deleted thread', async () => {
    await service.submitFeedback('usr_alice', THREAD, MESSAGE, { vote: 'up' });
    service.forgetThread('usr_alice', THREAD);
    expect(buffer.size).toBe(0);
    expect(getRuntimeMetricsSnapshot().portfolioAssistant.feedback.pendingVotes).toBe(0);
  });
});
