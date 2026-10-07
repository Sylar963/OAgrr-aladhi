import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PortfolioAssistantFeedbackRecord } from '@oggregator/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PortfolioAssistantFeedbackBuffer,
  PortfolioAssistantFeedbackBufferFullError,
  readBufferedPortfolioAssistantFeedback,
} from './portfolio-assistant-feedback-buffer.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const THREAD = '22222222-2222-4222-8222-222222222222';
const MESSAGE_1 = '11111111-1111-4111-8111-111111111111';
const MESSAGE_2 = '33333333-3333-4333-8333-333333333333';

function record(
  overrides: Partial<PortfolioAssistantFeedbackRecord> = {},
): PortfolioAssistantFeedbackRecord {
  return {
    userId: 'usr_a',
    messageId: MESSAGE_1,
    threadId: THREAD,
    vote: 'up',
    reasons: [],
    note: null,
    runTelemetry: null,
    createdAt: new Date('2026-10-07T12:00:00.000Z'),
    updatedAt: new Date('2026-10-07T12:00:00.000Z'),
    ...overrides,
  };
}

const log = { warn: vi.fn(), info: vi.fn() };

describe('PortfolioAssistantFeedbackBuffer', () => {
  let directory: string;
  let cachePath: string;
  let buffers: PortfolioAssistantFeedbackBuffer[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ogg-feedback-'));
    cachePath = join(directory, 'feedback.ndjson');
    buffers = [];
  });

  afterEach(() => {
    for (const buffer of buffers) buffer.dispose();
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  function open(
    upsertFeedback = vi.fn(async (rows: PortfolioAssistantFeedbackRecord[]) => ({
      written: rows.length,
      skipped: 0,
    })),
    maxPendingVotes = 100,
  ) {
    const buffer = new PortfolioAssistantFeedbackBuffer(
      { upsertFeedback },
      { cachePath, flushIntervalMs: DAY_MS, maxPendingVotes },
      log,
    );
    buffers.push(buffer);
    return { buffer, upsertFeedback };
  }

  it('keeps only the latest vote per user and message', () => {
    const { buffer } = open();
    buffer.put(record());
    buffer.put(
      record({
        vote: 'down',
        reasons: ['too_long'],
        updatedAt: new Date('2026-10-07T12:05:00.000Z'),
      }),
    );
    buffer.put(record({ userId: 'usr_b' }));

    expect(buffer.size).toBe(2);
    expect(buffer.get('usr_a', MESSAGE_1)).toMatchObject({ vote: 'down', reasons: ['too_long'] });
    expect(buffer.listForThread('usr_b', THREAD)).toHaveLength(1);
  });

  it('survives a restart through the on-disk outbox', () => {
    const first = open().buffer;
    first.put(record({ vote: 'down', reasons: ['wrong_numbers'], note: 'off by 10x' }));
    first.dispose();

    const { buffer } = open();
    expect(buffer.get('usr_a', MESSAGE_1)).toEqual(
      record({ vote: 'down', reasons: ['wrong_numbers'], note: 'off by 10x' }),
    );
    expect(readBufferedPortfolioAssistantFeedback(cachePath, log)).toHaveLength(1);
  });

  it('skips malformed outbox lines instead of failing startup', () => {
    writeFileSync(cachePath, '{"nope":true}\nnot json\n');
    const { buffer } = open();
    expect(buffer.size).toBe(0);
    expect(log.warn).toHaveBeenCalled();
  });

  it('flushes everything in one write batch and empties the outbox', async () => {
    const { buffer, upsertFeedback } = open();
    buffer.put(record());
    buffer.put(record({ messageId: MESSAGE_2, vote: 'down', reasons: ['refused'] }));

    expect(await buffer.flush()).toEqual({ batch: 2, written: 2, skipped: 0, pending: 0 });
    expect(upsertFeedback).toHaveBeenCalledTimes(1);
    expect(upsertFeedback.mock.calls[0]![0]).toHaveLength(2);
    expect(existsSync(cachePath)).toBe(false);
    await buffer.flush();
    expect(upsertFeedback).toHaveBeenCalledTimes(1);
  });

  it('keeps a vote that changed while its batch was being written', async () => {
    let release: () => void = () => undefined;
    const upsertFeedback = vi.fn(
      (rows: PortfolioAssistantFeedbackRecord[]) =>
        new Promise<{ written: number; skipped: number }>((resolve) => {
          release = () => resolve({ written: rows.length, skipped: 0 });
        }),
    );
    const { buffer } = open(upsertFeedback);
    buffer.put(record());
    const flushing = buffer.flush();
    buffer.put(record({ vote: 'down', updatedAt: new Date('2026-10-07T13:00:00.000Z') }));
    release();
    await flushing;

    expect(buffer.get('usr_a', MESSAGE_1)).toMatchObject({ vote: 'down' });
    expect(readFileSync(cachePath, 'utf8')).toContain('"vote":"down"');
  });

  it('keeps the outbox when the database write fails', async () => {
    const { buffer } = open(vi.fn(async () => Promise.reject(new Error('neon down'))));
    buffer.put(record());
    await expect(buffer.flush()).rejects.toThrow('neon down');
    expect(buffer.size).toBe(1);
    expect(readBufferedPortfolioAssistantFeedback(cachePath, log)).toHaveLength(1);
  });

  it('drops a deleted thread', () => {
    const { buffer } = open();
    buffer.put(record());
    buffer.put(record({ userId: 'usr_b' }));
    expect(buffer.dropThread('usr_a', THREAD)).toBe(1);
    expect(buffer.get('usr_a', MESSAGE_1)).toBeNull();
    expect(buffer.get('usr_b', MESSAGE_1)).not.toBeNull();
  });

  it('refuses new votes when full but still accepts changes', () => {
    const { buffer } = open(undefined, 1);
    buffer.put(record());
    expect(() => buffer.put(record({ messageId: MESSAGE_2 }))).toThrow(
      PortfolioAssistantFeedbackBufferFullError,
    );
    buffer.put(record({ vote: 'down' }));
    expect(buffer.get('usr_a', MESSAGE_1)).toMatchObject({ vote: 'down' });
  });

  it('flushes on the daily schedule, not per vote', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
    writeFileSync(`${cachePath}.last-flush`, `${Date.now()}\n`);
    const { buffer, upsertFeedback } = open();
    const flushed = vi.fn();
    buffer.start(flushed);
    for (let index = 0; index < 5; index += 1) {
      buffer.put(record({ vote: index % 2 === 0 ? 'up' : 'down' }));
    }

    await vi.advanceTimersByTimeAsync(DAY_MS - 1_000);
    expect(upsertFeedback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(upsertFeedback).toHaveBeenCalledTimes(1);
    expect(upsertFeedback.mock.calls[0]![0]).toEqual([record({ vote: 'up' })]);
    expect(flushed).toHaveBeenCalledWith({ batch: 1, written: 1, skipped: 0, pending: 0 });
  });
});
