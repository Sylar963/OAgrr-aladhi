import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChatMessageRow, ChatModerationRow } from '@oggregator/db';
import type { ChatServerMessage } from '@oggregator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatService, type ChatStore, sanitizeChatBody } from './social-chat.js';

const log = { warn: vi.fn(), info: vi.fn() };

function fakeStore(stored: ChatMessageRow[] = []) {
  const upserted: ChatMessageRow[][] = [];
  const moderation: ChatModerationRow[] = [];
  const store: ChatStore = {
    upsertChatMessages: vi.fn(async (rows: ChatMessageRow[]) => {
      upserted.push(rows);
      return rows.length;
    }),
    listRecentChatMessages: vi.fn(async () => stored),
    getChatMessage: vi.fn(async (id: string) => stored.find((row) => row.id === id) ?? null),
    listChatModeration: vi.fn(async () => moderation),
    upsertChatModeration: vi.fn(async (row: ChatModerationRow) => {
      moderation.push(row);
    }),
  };
  return { store, upserted };
}

function collector(userId: string) {
  const messages: ChatServerMessage[] = [];
  return { subscriber: { userId, send: (msg: ChatServerMessage) => messages.push(msg) }, messages };
}

describe('ChatService', () => {
  let directory: string;
  let cachePath: string;
  let nowMs: number;
  let services: ChatService[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ogg-chat-'));
    cachePath = join(directory, 'chat.ndjson');
    nowMs = Date.parse('2026-10-12T12:00:00.000Z');
    services = [];
  });

  afterEach(() => {
    for (const service of services) service.dispose();
    rmSync(directory, { recursive: true, force: true });
  });

  function create(store: ChatStore) {
    const service = new ChatService(
      store,
      {
        cachePath,
        flushIntervalMs: 86_400_000,
        historyLimit: 3,
        maxPendingMessages: 100,
        anonSecret: 'test-secret',
        minIntervalMs: 1_000,
        maxPerMinute: 5,
      },
      log,
      () => nowMs,
    );
    services.push(service);
    return service;
  }

  it('broadcasts messages with per-viewer ownership and never leaks user ids', async () => {
    const service = create(fakeStore().store);
    const alice = collector('usr_alice');
    const bob = collector('usr_bob');
    await service.subscribe(alice.subscriber, 'alice');
    await service.subscribe(bob.subscriber, null);

    await service.post('usr_alice', 'alice', { body: 'gm', anon: false });
    nowMs += 2_000;
    await service.post('usr_bob', null, { body: 'hello', anon: true });

    const bobSees = bob.messages.filter((msg) => msg.type === 'message');
    expect(bobSees.map((msg) => msg.type === 'message' && msg.message)).toMatchObject([
      { alias: 'alice', isAnon: false, mine: false, body: 'gm' },
      { alias: service.anonAlias('usr_bob'), isAnon: true, mine: true, body: 'hello' },
    ]);
    expect(JSON.stringify(bob.messages)).not.toContain('usr_alice');
  });

  it('requires a handle to post under a name and rate limits bursts', async () => {
    const service = create(fakeStore().store);
    await expect(service.post('usr_a', null, { body: 'hi', anon: false })).resolves.toEqual({
      ok: false,
      error: 'handle_required',
    });
    await expect(
      service.post('usr_a', 'a_user', { body: 'one', anon: false }),
    ).resolves.toMatchObject({ ok: true });
    await expect(service.post('usr_a', 'a_user', { body: 'two', anon: false })).resolves.toEqual({
      ok: false,
      error: 'rate_limited',
    });
  });

  it('rotates anonymous aliases daily', () => {
    const service = create(fakeStore().store);
    const today = service.anonAlias('usr_a');
    expect(today).toMatch(/^anon-[0-9a-f]{6}$/);
    expect(service.anonAlias('usr_a')).toBe(today);
    nowMs += 86_400_000;
    expect(service.anonAlias('usr_a')).not.toBe(today);
  });

  it('keeps messages on disk across restarts and writes them in one batch', async () => {
    const { store, upserted } = fakeStore();
    const first = create(store);
    await first.post('usr_a', 'a_user', { body: 'persist me', anon: false });
    first.dispose();

    const second = create(store);
    expect(second.pendingCount).toBe(1);
    const { subscriber, messages } = collector('usr_b');
    await second.subscribe(subscriber, null);
    const history = messages.find((msg) => msg.type === 'history');
    expect(history?.type === 'history' && history.messages.map((m) => m.body)).toEqual([
      'persist me',
    ]);

    await second.flush();
    expect(upserted).toHaveLength(1);
    expect(second.pendingCount).toBe(0);
    expect(store.upsertChatMessages).toHaveBeenCalledTimes(1);
  });

  it('lets authors delete only their own messages and queues the soft delete', async () => {
    const service = create(fakeStore().store);
    const viewer = collector('usr_b');
    await service.subscribe(viewer.subscriber, null);
    const posted = await service.post('usr_a', 'a_user', { body: 'oops', anon: false });
    if (!posted.ok) throw new Error('post failed');

    await expect(service.deleteOwn('usr_b', posted.message.id)).resolves.toBe('forbidden');
    await expect(service.deleteOwn('usr_a', posted.message.id)).resolves.toBeNull();
    expect(viewer.messages.at(-1)).toEqual({ type: 'deleted', id: posted.message.id });
    expect(service.pendingCount).toBe(1);
  });

  it('mutes and bans the author of a moderated message', async () => {
    const { store } = fakeStore();
    const service = create(store);
    const posted = await service.post('usr_a', 'a_user', { body: 'spam', anon: true });
    if (!posted.ok) throw new Error('post failed');

    await service.moderate(posted.message.id, { action: 'mute', minutes: 10 });
    nowMs += 2_000;
    await expect(service.post('usr_a', null, { body: 'more', anon: true })).resolves.toEqual({
      ok: false,
      error: 'muted',
    });

    await service.moderate(posted.message.id, { action: 'ban' });
    nowMs += 11 * 60_000;
    await expect(service.post('usr_a', null, { body: 'more', anon: true })).resolves.toEqual({
      ok: false,
      error: 'banned',
    });
    expect(store.upsertChatModeration).toHaveBeenCalledTimes(2);
  });
});

describe('sanitizeChatBody', () => {
  it('strips control characters and collapses blank lines', () => {
    expect(sanitizeChatBody('a\u0000b\n\n\n\nc\u007f ')).toBe('ab\n\nc');
  });
});
