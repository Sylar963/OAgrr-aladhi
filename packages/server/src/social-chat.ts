import { createHmac, randomBytes } from 'node:crypto';
import type { ChatMessageRow, ChatModerationRow, SocialStore } from '@oggregator/db';
import {
  CHAT_GLOBAL_ROOM,
  type ChatMessageDto,
  type ChatModerationRequest,
  type ChatServerMessage,
} from '@oggregator/protocol';
import { z } from 'zod';

import {
  appendJsonLines,
  type DeferredLog,
  FlushSchedule,
  readJsonLines,
  rewriteJsonLines,
} from './deferred-persistence.js';

export interface ChatServiceOptions {
  cachePath: string;
  flushIntervalMs: number;
  historyLimit: number;
  maxPendingMessages: number;
  /** Keys the daily anonymous alias; without a stable secret aliases rotate on restart. */
  anonSecret: string | null;
  minIntervalMs: number;
  maxPerMinute: number;
}

export interface ChatSubscriber {
  userId: string;
  send: (message: ChatServerMessage) => void;
}

export type ChatPostError =
  | 'banned'
  | 'muted'
  | 'handle_required'
  | 'rate_limited'
  | 'chat_busy'
  | 'not_found'
  | 'forbidden';

export type ChatStore = Pick<
  SocialStore,
  | 'upsertChatMessages'
  | 'listRecentChatMessages'
  | 'getChatMessage'
  | 'listChatModeration'
  | 'upsertChatModeration'
>;

const BufferedMessageSchema = z
  .object({
    id: z.string().min(1),
    room: z.string().min(1),
    userId: z.string().min(1),
    alias: z.string().min(1),
    isAnon: z.boolean(),
    body: z.string(),
    createdAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
  })
  .strict();

function decodeMessage(value: unknown): ChatMessageRow {
  const row = BufferedMessageSchema.parse(value);
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
  };
}

function encodeMessage(row: ChatMessageRow): Record<string, unknown> {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

export function sanitizeChatBody(body: string): string {
  return body
    .replace(CONTROL_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toDto(row: ChatMessageRow, viewerUserId: string): ChatMessageDto {
  return {
    id: row.id,
    alias: row.alias,
    isAnon: row.isAnon,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    mine: row.userId === viewerUserId,
  };
}

function nextModeration(
  existing: ChatModerationRow | undefined,
  userId: string,
  request: ChatModerationRequest,
  nowMs: number,
): ChatModerationRow {
  const base = {
    userId,
    mutedUntil: existing?.mutedUntil ?? null,
    banned: existing?.banned ?? false,
    reason: request.reason ?? existing?.reason ?? null,
    updatedAt: new Date(nowMs),
  };
  switch (request.action) {
    case 'mute':
      return { ...base, mutedUntil: new Date(nowMs + (request.minutes ?? 60) * 60_000) };
    case 'ban':
      return { ...base, banned: true };
    case 'unban':
      return { ...base, banned: false, mutedUntil: null };
    case 'delete':
      return base;
  }
}

/**
 * Global chat held in memory. Every change appends to a local NDJSON outbox (the last line per id
 * wins on reload) and Neon sees one upsert batch per daily FlushSchedule tick; the database is read
 * once, lazily, to seed history and moderation state.
 */
export class ChatService {
  private readonly pending = new Map<string, ChatMessageRow>();
  private recent: ChatMessageRow[] = [];
  private readonly moderation = new Map<string, ChatModerationRow>();
  private readonly subscribers = new Set<ChatSubscriber>();
  private readonly sendTimes = new Map<string, number[]>();
  private readonly anonSecret: string;
  private initialized: Promise<void> | null = null;
  private schedule: FlushSchedule | null = null;
  private flushing = false;

  constructor(
    private readonly store: ChatStore,
    private readonly options: ChatServiceOptions,
    private readonly log: DeferredLog & { info: (obj: object, msg: string) => void },
    private readonly now: () => number = Date.now,
  ) {
    this.anonSecret = options.anonSecret ?? randomBytes(32).toString('hex');
    for (const row of readJsonLines(options.cachePath, decodeMessage, log)) {
      this.pending.set(row.id, row);
    }
  }

  start(): void {
    if (this.schedule) return;
    this.schedule = new FlushSchedule(
      this.options.cachePath,
      this.options.flushIntervalMs,
      async () => {
        const result = await this.flush();
        this.log.info(result, 'chat messages flushed');
      },
      (err: unknown) => {
        this.log.warn(
          { err: err instanceof Error ? err.message : String(err), pending: this.pending.size },
          'chat flush failed',
        );
      },
    );
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get onlineCount(): number {
    return new Set([...this.subscribers].map((sub) => sub.userId)).size;
  }

  anonAlias(userId: string): string {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const digest = createHmac('sha256', this.anonSecret).update(`${userId}:${day}`).digest('hex');
    return `anon-${digest.slice(0, 6)}`;
  }

  mutedUntil(userId: string): Date | null {
    const row = this.moderation.get(userId);
    if (!row?.mutedUntil || row.mutedUntil.getTime() <= this.now()) return null;
    return row.mutedUntil;
  }

  async subscribe(subscriber: ChatSubscriber, handle: string | null): Promise<() => void> {
    await this.ensureInitialized();
    this.subscribers.add(subscriber);
    const mutedUntil = this.mutedUntil(subscriber.userId);
    subscriber.send({
      type: 'hello',
      room: CHAT_GLOBAL_ROOM,
      online: this.onlineCount,
      handle,
      anonAlias: this.anonAlias(subscriber.userId),
      mutedUntil: mutedUntil?.toISOString() ?? null,
    });
    subscriber.send({
      type: 'history',
      messages: this.recent.map((row) => toDto(row, subscriber.userId)),
    });
    this.broadcastPresence();
    return () => {
      if (this.subscribers.delete(subscriber)) this.broadcastPresence();
    };
  }

  async post(
    userId: string,
    handle: string | null,
    input: { body: string; anon: boolean },
  ): Promise<{ ok: true; message: ChatMessageRow } | { ok: false; error: ChatPostError }> {
    await this.ensureInitialized();
    const moderation = this.moderation.get(userId);
    if (moderation?.banned) return { ok: false, error: 'banned' };
    if (this.mutedUntil(userId)) return { ok: false, error: 'muted' };
    if (!input.anon && !handle) return { ok: false, error: 'handle_required' };
    if (!this.allowSend(userId)) return { ok: false, error: 'rate_limited' };
    if (this.pending.size >= this.options.maxPendingMessages) {
      return { ok: false, error: 'chat_busy' };
    }
    const body = sanitizeChatBody(input.body);
    if (body.length === 0) return { ok: false, error: 'forbidden' };

    const row: ChatMessageRow = {
      id: `msg_${crypto.randomUUID()}`,
      room: CHAT_GLOBAL_ROOM,
      userId,
      alias: input.anon || !handle ? this.anonAlias(userId) : handle,
      isAnon: input.anon || !handle,
      body,
      createdAt: new Date(this.now()),
      deletedAt: null,
    };
    this.pending.set(row.id, row);
    appendJsonLines(this.options.cachePath, [row], encodeMessage);
    this.recent.push(row);
    if (this.recent.length > this.options.historyLimit) {
      this.recent = this.recent.slice(-this.options.historyLimit);
    }
    for (const subscriber of this.subscribers) {
      subscriber.send({ type: 'message', message: toDto(row, subscriber.userId) });
    }
    return { ok: true, message: row };
  }

  /** Authors can delete their own messages that are still in recent history. */
  async deleteOwn(userId: string, id: string): Promise<ChatPostError | null> {
    await this.ensureInitialized();
    const row = this.recent.find((message) => message.id === id);
    if (!row) return 'not_found';
    if (row.userId !== userId) return 'forbidden';
    this.softDelete(row);
    return null;
  }

  async moderate(
    messageId: string,
    request: ChatModerationRequest,
  ): Promise<{ userId: string } | null> {
    await this.ensureInitialized();
    const row =
      this.recent.find((message) => message.id === messageId) ??
      this.pending.get(messageId) ??
      (await this.store.getChatMessage(messageId));
    if (!row) return null;

    if (request.action === 'delete' || request.action === 'ban') this.softDelete(row);
    if (request.action !== 'delete') {
      const next = nextModeration(this.moderation.get(row.userId), row.userId, request, this.now());
      await this.store.upsertChatModeration(next);
      this.moderation.set(row.userId, next);
    }
    return { userId: row.userId };
  }

  async flush(): Promise<{ batch: number; written: number; pending: number }> {
    if (this.flushing || this.pending.size === 0) {
      return { batch: 0, written: 0, pending: this.pending.size };
    }
    this.flushing = true;
    const batch = [...this.pending.entries()];
    try {
      const written = await this.store.upsertChatMessages(batch.map(([, row]) => row));
      // A message deleted while the batch was in flight is a new object and stays queued.
      for (const [id, row] of batch) {
        if (this.pending.get(id) === row) this.pending.delete(id);
      }
      rewriteJsonLines(this.options.cachePath, [...this.pending.values()], encodeMessage);
      return { batch: batch.length, written, pending: this.pending.size };
    } finally {
      this.flushing = false;
    }
  }

  /** Messages stay on disk; a restart must not cost a database write. */
  dispose(): void {
    this.schedule?.dispose();
    this.schedule = null;
    this.subscribers.clear();
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.initialize().catch((err: unknown) => {
        this.initialized = null;
        throw err;
      });
    }
    return this.initialized;
  }

  private async initialize(): Promise<void> {
    const [moderation, stored] = await Promise.all([
      this.store.listChatModeration(),
      this.store.listRecentChatMessages(CHAT_GLOBAL_ROOM, this.options.historyLimit),
    ]);
    for (const row of moderation) this.moderation.set(row.userId, row);
    const byId = new Map(stored.map((row) => [row.id, row]));
    for (const row of this.pending.values()) {
      if (row.room === CHAT_GLOBAL_ROOM) byId.set(row.id, row);
    }
    this.recent = [...byId.values()]
      .filter((row) => row.deletedAt == null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-this.options.historyLimit);
  }

  private softDelete(row: ChatMessageRow): void {
    if (row.deletedAt) return;
    const deleted: ChatMessageRow = { ...row, deletedAt: new Date(this.now()) };
    this.pending.set(row.id, deleted);
    appendJsonLines(this.options.cachePath, [deleted], encodeMessage);
    this.recent = this.recent.filter((message) => message.id !== row.id);
    for (const subscriber of this.subscribers) subscriber.send({ type: 'deleted', id: row.id });
  }

  private allowSend(userId: string): boolean {
    const nowMs = this.now();
    const times = (this.sendTimes.get(userId) ?? []).filter((ts) => nowMs - ts < 60_000);
    const last = times.at(-1);
    if (last != null && nowMs - last < this.options.minIntervalMs) return false;
    if (times.length >= this.options.maxPerMinute) return false;
    times.push(nowMs);
    this.sendTimes.set(userId, times);
    return true;
  }

  private broadcastPresence(): void {
    const online = this.onlineCount;
    for (const subscriber of this.subscribers) subscriber.send({ type: 'presence', online });
  }
}
