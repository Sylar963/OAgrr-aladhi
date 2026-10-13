import type pino from 'pino';
import WebSocket from 'ws';
import { logger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';
import { closeSocketQuietly, redactWsUrl } from '../../utils/ws.js';

const RETRY_AFTER_MAX_ATTEMPTS_MS = 60_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 20;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 90_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
// Resetting the backoff on bare `open` would let a socket that opens and immediately drops
// reconnect every ~1s forever, so the attempt counter only resets once a session survives this long.
const DEFAULT_STABLE_SESSION_MS = 60_000;
const MAX_IDLE_CHECK_INTERVAL_MS = 15_000;

export type PingMessage = string | Record<string, unknown>;

function isRateLimitSignal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(^|\D)429(\D|$)|over_limit|rate\s*limit|too many requests/i.test(message);
}

export interface TopicWsClientOptions {
  pingIntervalMs?: number;
  pingMessage?: PingMessage | (() => PingMessage);
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  rateLimitCooldownMs?: number;
  handshakeTimeoutMs?: number;
  stableSessionMs?: number;
  /** Terminate an open socket that receives no frame (data, ping or pong) for this long. Off when unset. */
  idleTimeoutMs?: number;
  onStatusChange?: (state: 'connected' | 'reconnecting' | 'down') => void;
  onSocket?: (socket: WebSocket) => void;
  getReplayMessages?: () => Array<string | Record<string, unknown>>;
  onOpen?: () => void | Promise<void>;
  onMessage?: (raw: WebSocket.RawData) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  skipUtf8Validation?: boolean;
}

export class TopicWsClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private stableSessionTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private lastActivityAt = 0;
  private rateLimitUntil = 0;
  private rateLimitHits = 0;
  private connectedAt = 0;
  private readonly log: pino.Logger;

  constructor(
    private readonly url: string | (() => string),
    private readonly label: string,
    private readonly options: TopicWsClientOptions = {},
  ) {
    this.log = logger.child({ component: this.label });
  }

  // Signed venues (Coincall) embed a timestamped HMAC in the URL that expires.
  // Resolving the factory on every (re)connect keeps the signature fresh
  // instead of replaying the one captured at construction.
  private resolveUrl(): string {
    return typeof this.url === 'function' ? this.url() : this.url;
  }

  get socket(): WebSocket | null {
    return this.ws;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get connectedAtMs(): number {
    return this.connectedAt;
  }

  get lastActivityAtMs(): number {
    return this.lastActivityAt;
  }

  terminate(): void {
    this.ws?.terminate();
  }

  private detachSocket(socket: WebSocket): void {
    socket.removeAllListeners();
  }

  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    if (this.connectPromise != null) return this.connectPromise;

    this.shouldReconnect = true;

    this.connectPromise = new Promise((resolve, reject) => {
      const url = this.resolveUrl();
      const socket = new WebSocket(url, {
        skipUTF8Validation: this.options.skipUtf8Validation ?? false,
        // Inflating thousands of small frames per second cost ~15% of the main thread in profiles;
        // raw frames trade a few MB/s of bandwidth for that CPU.
        perMessageDeflate: false,
      });
      let settled = false;

      const resolveConnect = (): void => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        resolve();
      };

      const rejectConnect = (error: Error): void => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        reject(error);
      };

      this.ws = socket;
      this.options.onSocket?.(socket);

      const handshakeTimeoutMs = this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
      this.clearHandshakeTimer();
      this.handshakeTimer = setTimeout(() => {
        this.handshakeTimer = null;
        if (this.ws !== socket || socket.readyState !== WebSocket.CONNECTING) return;
        this.log.warn({ timeoutMs: handshakeTimeoutMs }, 'ws handshake timeout, terminating');
        // Aborting the upgrade emits 'error' then 'close'; the close handler schedules the retry.
        socket.terminate();
      }, handshakeTimeoutMs);

      socket.on('open', () => {
        if (this.ws !== socket) return;

        this.clearHandshakeTimer();
        this.connectedAt = Date.now();
        this.lastActivityAt = this.connectedAt;
        this.rateLimitUntil = 0;
        this.log.info({ url: redactWsUrl(url) }, 'ws connected');
        this.startStableSessionTimer();
        this.startIdleWatch(socket);
        this.startPing();
        this.options.onStatusChange?.('connected');

        Promise.resolve(this.replaySubscriptions())
          .then(() => this.options.onOpen?.())
          .then(() => resolveConnect())
          .catch((error: unknown) =>
            rejectConnect(error instanceof Error ? error : new Error(String(error))),
          );
      });

      socket.on('message', (raw: WebSocket.RawData) => {
        if (this.ws !== socket) return;
        this.lastActivityAt = Date.now();
        this.options.onMessage?.(raw);
      });

      socket.on('ping', () => {
        if (this.ws !== socket) return;
        this.lastActivityAt = Date.now();
      });

      socket.on('pong', () => {
        if (this.ws !== socket) return;
        this.lastActivityAt = Date.now();
      });

      socket.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.length > 0 ? reason.toString() : undefined;
        const uptimeMs = this.connectedAt > 0 ? Date.now() - this.connectedAt : undefined;
        this.log.warn({ closeCode: code, closeReason: reasonStr, uptimeMs }, 'ws closed');
        this.noteRateLimit(reasonStr);

        if (!settled) {
          rejectConnect(new Error(`[${this.label}] socket closed before connect completed`));
        }

        if (this.ws !== socket) return;

        this.ws = null;
        this.cleanup();
        this.detachSocket(socket);
        this.options.onClose?.();
        this.options.onStatusChange?.('reconnecting');
        if (this.shouldReconnect) this.scheduleReconnect();
      });

      socket.on('error', (error) => {
        this.log.error({ err: error.message }, 'ws error');
        this.noteRateLimit(error);
        this.options.onError?.(error);
        if (socket.readyState !== WebSocket.OPEN) rejectConnect(error);
      });
    });

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.connectPromise = null;
    this.cleanup();
    if (this.ws != null) {
      const socket = this.ws;
      this.ws = null;
      closeSocketQuietly(socket);
    }
  }

  send(payload: string | Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }

  sendPong(data?: Buffer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.pong(data);
  }

  on(event: 'ping', listener: (data: Buffer) => void): void {
    this.ws?.on(event, listener);
  }

  private replaySubscriptions(): void {
    const messages = this.options.getReplayMessages?.() ?? [];
    for (const message of messages) {
      this.send(message);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.isConnected || this.connectPromise != null) return;
    if (this.reconnectTimer != null) return;

    const maxAttempts = this.options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    const exceededMaxAttempts = this.reconnectAttempts >= maxAttempts;
    const baseDelay = exceededMaxAttempts
      ? RETRY_AFTER_MAX_ATTEMPTS_MS
      : backoffDelay(
          this.reconnectAttempts,
          this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
        );
    const delay = Math.max(baseDelay, this.remainingRateLimitCooldownMs());

    this.reconnectAttempts += 1;

    if (exceededMaxAttempts) {
      this.log.error(
        { maxAttempts, delayMs: delay },
        'max reconnect attempts reached, switching to periodic retry',
      );
      this.options.onStatusChange?.('down');
    } else {
      this.log.info({ delayMs: delay, attempt: this.reconnectAttempts }, 'reconnecting');
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.connect();
      } catch (error: unknown) {
        this.noteRateLimit(error);
        this.log.warn({ err: String(error) }, 'reconnect failed');
        if (this.shouldReconnect && this.isConnected) {
          this.ws?.terminate();
        } else if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  private startPing(): void {
    this.stopPing();

    const pingIntervalMs = this.options.pingIntervalMs;
    const pingMessage = this.options.pingMessage;
    if (pingIntervalMs == null || pingMessage == null) return;

    this.pingTimer = setInterval(() => {
      this.send(typeof pingMessage === 'function' ? pingMessage() : pingMessage);
    }, pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private startStableSessionTimer(): void {
    this.clearStableSessionTimer();
    this.stableSessionTimer = setTimeout(() => {
      this.stableSessionTimer = null;
      this.reconnectAttempts = 0;
    }, this.options.stableSessionMs ?? DEFAULT_STABLE_SESSION_MS);
  }

  private clearStableSessionTimer(): void {
    if (this.stableSessionTimer != null) {
      clearTimeout(this.stableSessionTimer);
      this.stableSessionTimer = null;
    }
  }

  private startIdleWatch(socket: WebSocket): void {
    this.stopIdleWatch();
    const idleTimeoutMs = this.options.idleTimeoutMs;
    if (idleTimeoutMs == null) return;

    const checkEveryMs = Math.min(MAX_IDLE_CHECK_INTERVAL_MS, Math.max(1_000, idleTimeoutMs / 3));
    this.idleTimer = setInterval(() => {
      if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      const idleMs = Date.now() - this.lastActivityAt;
      if (idleMs < idleTimeoutMs) return;
      this.log.warn({ idleMs, idleTimeoutMs }, 'ws idle, terminating');
      socket.terminate();
    }, checkEveryMs);
  }

  private stopIdleWatch(): void {
    if (this.idleTimer != null) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer != null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPing();
    this.stopIdleWatch();
    this.clearStableSessionTimer();
    this.clearHandshakeTimer();
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private remainingRateLimitCooldownMs(): number {
    return Math.max(0, this.rateLimitUntil - Date.now());
  }

  private noteRateLimit(error: unknown): void {
    if (!isRateLimitSignal(error)) return;

    const cooldownMs = this.options.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    const until = Date.now() + cooldownMs;
    if (until > this.rateLimitUntil) {
      this.rateLimitUntil = until;
    }
    this.rateLimitHits += 1;
    this.log.warn(
      { cooldownMs, rateLimitHits: this.rateLimitHits, retryAt: this.rateLimitUntil },
      'rate limit detected, delaying reconnects',
    );
  }
}
