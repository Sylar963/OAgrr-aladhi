import type WebSocket from 'ws';
import type { OrderBookSnapshot } from '../../liquidity/types.js';
import { feedLogger } from '../../utils/logger.js';
import { THALEX_MARKET_WS_URL } from '../shared/endpoints.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import { mintAuthToken } from '../thalex-private/auth.js';
import {
  instrumentFromBookChannel,
  instrumentFromTickerChannel,
  THALEX_DEFAULT_BOOK_DEPTH,
  ThalexBookState,
  thalexBookChannel,
  thalexBookTickerChannel,
} from './book.js';
import {
  ThalexBookNotificationSchema,
  ThalexRpcErrorSchema,
  ThalexSubscribeAckSchema,
  ThalexTickerNotificationSchema,
} from './types.js';

const log = feedLogger('thalex-book');
const DEFAULT_FLUSH_INTERVAL_MS = 100;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_CHANNELS_PER_BATCH = 200;

export type BookFeedStatus = 'connected' | 'reconnecting' | 'down';

export interface ThalexBookFeedEvents {
  onBook(book: OrderBookSnapshot): void;
  /** Thalex acknowledged the subscribe but left this instrument's book channel out. */
  onRejected?(instrument: string): void;
  onStatus?(status: BookFeedStatus): void;
}

export interface BookSocket {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(payload: Record<string, unknown>): void;
  readonly isConnected: boolean;
}

export interface BookSocketOptions {
  onMessage(raw: string): void;
  onStatusChange(status: BookFeedStatus): void;
  getReplayMessages(): Array<Record<string, unknown>>;
}

/**
 * Thalex caps unauthenticated sockets per IP and refuses subscribes past the cap; a logged-in
 * socket is not counted. Market data only: the session never sends private requests.
 */
export interface ThalexBookAuth {
  kid: string;
  privateKeyPem: string;
  account?: string;
}

export interface ThalexBookFeedOptions {
  depth?: number;
  flushIntervalMs?: number;
  now?: () => number;
  createSocket?: (options: BookSocketOptions) => BookSocket;
}

/** Book channels get their own socket so fast book traffic can't stall the chain feed. */
function createTopicSocket(options: BookSocketOptions): BookSocket {
  return new TopicWsClient(THALEX_MARKET_WS_URL, 'thalex-book', {
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    onStatusChange: options.onStatusChange,
    getReplayMessages: options.getReplayMessages,
    onMessage: (raw: WebSocket.RawData) => options.onMessage(raw.toString()),
  });
}

/**
 * Demand-driven Thalex L2 books: `add` subscribes an instrument's book and ticker, `remove`
 * drops them. Books are pushed at most once per instrument per flush interval.
 */
export class ThalexBookFeed {
  private readonly books = new Map<string, ThalexBookState>();
  private readonly dirty = new Set<string>();
  private readonly pendingSubscribes = new Map<number, string[]>();
  private readonly depth: number;
  private readonly flushIntervalMs: number;
  private readonly now: () => number;
  private readonly socket: BookSocket;
  private generation = 1;
  private nextId = 1;
  private auth: ThalexBookAuth | null = null;
  // Set while a login is in flight; subscribes wait for its reply.
  private loginId: number | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly events: ThalexBookFeedEvents,
    options: ThalexBookFeedOptions = {},
  ) {
    this.depth = options.depth ?? THALEX_DEFAULT_BOOK_DEPTH;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.socket = (options.createSocket ?? createTopicSocket)({
      onMessage: (raw) => this.handleMessage(raw),
      onStatusChange: (status) => this.handleStatus(status),
      getReplayMessages: () => this.replayMessages(),
    });
  }

  instruments(): string[] {
    return [...this.books.keys()];
  }

  /** Changing the login reconnects, since a session cannot log out or switch keys. */
  setAuth(auth: ThalexBookAuth | null): void {
    const unchanged =
      auth?.kid === this.auth?.kid &&
      auth?.privateKeyPem === this.auth?.privateKeyPem &&
      auth?.account === this.auth?.account;
    if (unchanged || this.stopped) return;
    this.auth = auth;
    if (!this.socket.isConnected) return;
    void this.socket
      .disconnect()
      .then(() => (this.books.size > 0 && !this.stopped ? this.socket.connect() : undefined))
      .catch((err: unknown) => log.warn({ err: String(err) }, 'reconnect after login change failed'));
  }

  add(instrument: string): void {
    if (this.stopped || this.books.has(instrument)) return;
    this.books.set(instrument, new ThalexBookState(instrument, this.depth));
    this.startFlushing();
    if (this.socket.isConnected) {
      // A pending login subscribes every held instrument once it is answered.
      if (this.loginId === null) this.socket.send(this.subscribeMessage(this.channelsFor(instrument)));
    } else {
      this.socket.connect().catch((err: unknown) => log.warn({ err: String(err) }, 'connect failed'));
    }
  }

  remove(instrument: string): void {
    if (!this.books.delete(instrument)) return;
    this.dirty.delete(instrument);
    if (this.socket.isConnected) {
      this.socket.send({
        method: 'unsubscribe',
        id: this.nextId++,
        params: { channels: this.channelsFor(instrument) },
      });
    }
    if (this.books.size === 0) {
      this.stopFlushing();
      void this.socket.disconnect();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopFlushing();
    this.books.clear();
    await this.socket.disconnect();
  }

  /** Exposed for tests; the timer calls it. */
  flush(): void {
    for (const instrument of this.dirty) {
      const book = this.books.get(instrument);
      if (book) this.events.onBook(book.toSnapshot());
    }
    this.dirty.clear();
  }

  private channelsFor(instrument: string): string[] {
    return [thalexBookChannel(instrument, this.depth), thalexBookTickerChannel(instrument)];
  }

  private subscribeMessage(channels: string[]): Record<string, unknown> {
    const id = this.nextId++;
    this.pendingSubscribes.set(id, channels);
    return { method: 'public/subscribe', id, params: { channels } };
  }

  private replayMessages(): Array<Record<string, unknown>> {
    this.pendingSubscribes.clear();
    this.loginId = null;
    const login = this.loginMessage();
    return login != null ? [login] : this.subscribeAllMessages();
  }

  private loginMessage(): Record<string, unknown> | null {
    if (this.auth == null) return null;
    let token: string;
    try {
      token = mintAuthToken({ kid: this.auth.kid, privateKeyPem: this.auth.privateKeyPem });
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'book login token failed');
      return null;
    }
    const id = this.nextId++;
    this.loginId = id;
    const params: Record<string, unknown> = { token };
    if (this.auth.account != null) params['account'] = this.auth.account;
    return { method: 'public/login', id, params };
  }

  private subscribeAllMessages(): Array<Record<string, unknown>> {
    const channels = this.instruments().flatMap((i) => this.channelsFor(i));
    const messages: Array<Record<string, unknown>> = [];
    for (let i = 0; i < channels.length; i += MAX_CHANNELS_PER_BATCH) {
      messages.push(this.subscribeMessage(channels.slice(i, i + MAX_CHANNELS_PER_BATCH)));
    }
    return messages;
  }

  private handleStatus(status: BookFeedStatus): void {
    if (status !== 'connected') {
      // No sequence numbers on Thalex books: after any drop only a fresh snapshot is trustworthy.
      this.generation += 1;
      for (const [instrument, book] of this.books) {
        book.markUnsynchronized(this.generation);
        this.dirty.add(instrument);
      }
    }
    this.events.onStatus?.(status);
  }

  private handleMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      log.debug('malformed book frame');
      return;
    }
    const channel = (json as { channel_name?: unknown }).channel_name;
    if (typeof channel === 'string') {
      this.handleNotification(channel, json);
      return;
    }
    this.handleRpcReply(json);
  }

  private handleNotification(channel: string, json: unknown): void {
    const receivedAt = this.now();
    const bookInstrument = instrumentFromBookChannel(channel);
    if (bookInstrument !== null) {
      const book = this.books.get(bookInstrument);
      const parsed = ThalexBookNotificationSchema.safeParse(json);
      if (!book || !parsed.success) return;
      const result = book.apply(
        parsed.data.notification,
        parsed.data.snapshot === true,
        receivedAt,
        this.generation,
      );
      if (result === 'invalid') this.resubscribe(bookInstrument);
      if (result !== 'ignored') this.dirty.add(bookInstrument);
      return;
    }
    const tickerInstrument = instrumentFromTickerChannel(channel);
    if (tickerInstrument !== null) {
      const book = this.books.get(tickerInstrument);
      const parsed = ThalexTickerNotificationSchema.safeParse(json);
      if (!book || !parsed.success) return;
      book.applyTicker(parsed.data.notification, receivedAt);
      this.dirty.add(tickerInstrument);
    }
  }

  private handleRpcReply(json: unknown): void {
    const id = (json as { id?: unknown }).id;
    if (this.loginId !== null && id === this.loginId) {
      this.loginId = null;
      const failed = ThalexRpcErrorSchema.safeParse(json);
      if (failed.success) {
        log.warn({ code: failed.data.error.code, message: failed.data.error.message }, 'book login failed');
      } else {
        log.info('book socket logged in');
      }
      for (const message of this.subscribeAllMessages()) this.socket.send(message);
      return;
    }
    const ack = ThalexSubscribeAckSchema.safeParse(json);
    if (ack.success && typeof ack.data.id === 'number') {
      const requested = this.pendingSubscribes.get(ack.data.id);
      if (!requested) return;
      this.pendingSubscribes.delete(ack.data.id);
      // Thalex answers success even for unknown channels; it just leaves them out.
      const accepted = new Set(ack.data.result);
      for (const channel of requested) {
        const instrument = instrumentFromBookChannel(channel);
        if (instrument !== null && !accepted.has(channel)) this.reject(instrument);
      }
      return;
    }
    const error = ThalexRpcErrorSchema.safeParse(json);
    if (error.success && typeof error.data.id === 'number') {
      const requested = this.pendingSubscribes.get(error.data.id);
      if (!requested) return;
      this.pendingSubscribes.delete(error.data.id);
      log.warn({ code: error.data.error.code, message: error.data.error.message }, 'book subscribe failed');
      for (const channel of requested) {
        const instrument = instrumentFromBookChannel(channel);
        if (instrument !== null) this.reject(instrument);
      }
    }
  }

  private reject(instrument: string): void {
    if (!this.books.has(instrument)) return;
    this.events.onRejected?.(instrument);
  }

  private resubscribe(instrument: string): void {
    if (!this.socket.isConnected) return;
    const channels = [thalexBookChannel(instrument, this.depth)];
    this.socket.send({ method: 'unsubscribe', id: this.nextId++, params: { channels } });
    this.socket.send(this.subscribeMessage(channels));
  }

  private startFlushing(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  private stopFlushing(): void {
    if (this.flushTimer !== null) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }
}
