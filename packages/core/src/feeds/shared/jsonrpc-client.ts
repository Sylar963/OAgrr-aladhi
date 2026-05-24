import type pino from 'pino';
import WebSocket from 'ws';
import { logger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';

/**
 * Shared JSON-RPC 2.0 over WebSocket base for Deribit and Derive.
 * Handles: connection lifecycle, heartbeat, reconnection,
 * request/response correlation, and subscription dispatch.
 */
const RETRY_AFTER_MAX_ATTEMPTS_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_SEC = 30;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 20;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_RESUBSCRIBE_BATCH_SIZE = 200;
const DEFAULT_RESUBSCRIBE_BATCH_DELAY_MS = 350;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 90_000;
const DEFAULT_MAX_COOLDOWN_TOTAL_MS = 5 * 60 * 1000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
const SEC_TO_MS = 1_000;

// Deribit closes the connection if the `public/test` response lags behind the
// heartbeat deadline. Log whenever our response is even close to that boundary
// so we can distinguish outbound-buffer congestion from other failure modes.
const SLOW_TEST_RESPONSE_THRESHOLD_MS = 100;

interface JsonRpcPendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: { channel?: string; data?: unknown; type?: string };
}

function isConnectionClosedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('connection closed');
}

function isRateLimitSignal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(^|\D)429(\D|$)|over_limit|rate\s*limit|too many requests/i.test(message);
}

export class JsonRpcWsClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, JsonRpcPendingRequest>();
  private subscriptionHandler: ((channel: string, data: unknown) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private subscribedChannels = new Set<string>();
  private heartbeatToken = 0;
  private lastActivityAt = 0;
  private rateLimitUntil = 0;
  private rateLimitFirstHitAt = 0;
  private rateLimitHits = 0;
  private connectedAt = 0;
  private log: pino.Logger;

  constructor(
    private readonly url: string,
    private readonly label: string,
    private readonly options: {
      heartbeatIntervalSec?: number;
      requestTimeoutMs?: number;
      maxReconnectAttempts?: number;
      reconnectDelayMs?: number;
      subscribeMethod?: string;
      unsubscribeMethod?: string;
      unsubscribeAllMethod?: string;
      resubscribeBatchSize?: number;
      resubscribeBatchDelayMs?: number;
      rateLimitCooldownMs?: number;
      maxCooldownTotalMs?: number;
      handshakeTimeoutMs?: number;
      onStatusChange?: (state: 'connected' | 'reconnecting' | 'down') => void;
    } = {},
  ) {
    this.log = logger.child({ component: this.label });
  }

  // ─── connection lifecycle ─────────────────────────────────────

  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    if (this.connectPromise != null) return this.connectPromise;

    this.shouldReconnect = true;

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let settled = false;

      const resolveConnect = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimer);
        this.connectPromise = null;
        resolve();
      };

      const rejectConnect = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimer);
        this.connectPromise = null;
        reject(error);
      };

      this.ws = socket;

      // Guard against upstream WS upgrades that accept TCP but never complete —
      // the close handler downstream will pick up the resulting termination and
      // schedule the next reconnect attempt.
      const timeoutMs = this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
      const handshakeTimer = setTimeout(() => {
        if (settled) return;
        this.log.warn({ url: this.url, timeoutMs }, 'ws handshake timeout, terminating');
        socket.terminate();
        rejectConnect(new Error(`[${this.label}] handshake timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.on('open', () => {
        if (this.ws !== socket) return;

        this.connectedAt = Date.now();
        this.lastActivityAt = this.connectedAt;
        this.rateLimitUntil = 0;
        this.rateLimitFirstHitAt = 0;
        this.log.info({ url: this.url }, 'ws connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.options.onStatusChange?.('connected');
        resolveConnect();
      });

      socket.on('message', (raw: WebSocket.RawData) => {
        if (this.ws !== socket) return;
        this.lastActivityAt = Date.now();

        try {
          const msg = JSON.parse(raw.toString()) as JsonRpcMessage;
          this.handleMessage(msg);
        } catch (e: unknown) {
          this.log.debug({ err: String(e) }, 'malformed WS frame');
        }
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
        this.log.warn(
          {
            closeCode: code,
            closeReason: reasonStr,
            uptimeMs,
            channels: this.subscribedChannels.size,
          },
          'ws closed',
        );
        this.noteRateLimit(reasonStr);

        if (!settled) {
          rejectConnect(new Error(`[${this.label}] socket closed before connect completed`));
        }

        if (this.ws !== socket) return;

        this.ws = null;
        this.cleanup();
        this.detachSocket(socket);
        this.options.onStatusChange?.('reconnecting');
        if (this.shouldReconnect) this.scheduleReconnect();
      });

      socket.on('error', (err) => {
        this.log.error({ err: err.message }, 'ws error');
        this.noteRateLimit(err);
        if (socket.readyState !== WebSocket.OPEN) rejectConnect(err);
      });
    });

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.connectPromise = null;
    this.cleanup();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      this.detachSocket(socket);
      socket.close();
    }
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

  // ─── JSON-RPC request/response ────────────────────────────────

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.isConnected) throw new Error(`[${this.label}] not connected`);

    const id = this.nextId++;
    const timeout = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[${this.label}] ${method} timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });

      this.ws!.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }),
      );
    });
  }

  // ─── subscriptions ────────────────────────────────────────────

  onSubscription(handler: (channel: string, data: unknown) => void): void {
    this.subscriptionHandler = handler;
  }

  async subscribe(channels: string[], source = 'unknown'): Promise<void> {
    const method = this.options.subscribeMethod ?? 'public/subscribe';
    const added: string[] = [];

    for (const channel of channels) {
      if (this.subscribedChannels.has(channel)) continue;
      this.subscribedChannels.add(channel);
      added.push(channel);
    }

    this.log.info(
      {
        source,
        requested: channels.length,
        added: added.length,
        totalChannels: this.subscribedChannels.size,
      },
      'subscribe',
    );

    try {
      await this.call(method, { channels });
    } catch (error: unknown) {
      if (!isConnectionClosedError(error)) {
        for (const channel of added) {
          this.subscribedChannels.delete(channel);
        }
      }
      throw error;
    }
  }

  async unsubscribe(channels: string[]): Promise<void> {
    if (!this.isConnected) return;
    const method = this.options.unsubscribeMethod ?? 'public/unsubscribe';
    try {
      await this.call(method, { channels });
    } catch (e: unknown) {
      this.log.debug({ err: String(e) }, 'unsubscribe failed');
    }
    for (const channel of channels) {
      this.subscribedChannels.delete(channel);
    }
  }

  async unsubscribeAll(): Promise<void> {
    if (!this.isConnected) return;
    const method = this.options.unsubscribeAllMethod ?? 'public/unsubscribe_all';
    try {
      await this.call(method, {});
    } catch (e: unknown) {
      this.log.debug({ err: String(e) }, 'unsubscribe_all failed');
    }
    this.subscribedChannels.clear();
  }

  // ─── message dispatch ─────────────────────────────────────────

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id != null && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);

      if (msg.error) {
        this.noteRateLimit(msg.error.message);
        entry.reject(
          new Error(`[${this.label}] RPC error ${msg.error.code}: ${msg.error.message}`),
        );
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    // Heartbeat test_request — must respond with public/test
    if (msg.method === 'heartbeat' && msg.params?.type === 'test_request') {
      const receivedAt = Date.now();
      const bufferedBefore = this.ws?.bufferedAmount ?? 0;
      this.ws?.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
          method: 'public/test',
          params: {},
        }),
      );
      const elapsedMs = Date.now() - receivedAt;
      if (elapsedMs >= SLOW_TEST_RESPONSE_THRESHOLD_MS || bufferedBefore > 0) {
        this.log.warn(
          { elapsedMs, bufferedBefore, channels: this.subscribedChannels.size },
          'slow test_request response',
        );
      }
      return;
    }

    if (msg.method === 'subscription' && msg.params) {
      const channel = msg.params.channel;
      const data = msg.params.data;
      if (channel != null && this.subscriptionHandler) {
        this.subscriptionHandler(channel, data);
      }
      return;
    }
  }

  // ─── heartbeat ────────────────────────────────────────────────

  private startHeartbeat(): void {
    const interval = this.options.heartbeatIntervalSec ?? DEFAULT_HEARTBEAT_INTERVAL_SEC;
    const heartbeatToken = ++this.heartbeatToken;

    this.call('public/set_heartbeat', { interval }).catch(() => {
      if (heartbeatToken !== this.heartbeatToken || !this.shouldReconnect) return;

      // Derive doesn't support set_heartbeat — use ping/pong instead.
      this.heartbeatTimer = setInterval(() => {
        if (this.isConnected) this.ws!.ping();
      }, interval * SEC_TO_MS);
    });
  }

  // ─── reconnection ────────────────────────────────────────────

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
        await this.resubscribe();
      } catch (e: unknown) {
        this.noteRateLimit(e);
        this.log.warn({ err: String(e) }, 'reconnect failed');
        if (this.shouldReconnect && this.isConnected) {
          this.ws?.terminate();
        }
      }
    }, delay);
  }

  /** Re-subscribe in batches to stay within exchange rate limits on reconnect. */
  private async resubscribe(): Promise<void> {
    if (this.subscribedChannels.size === 0) return;

    const method = this.options.subscribeMethod ?? 'public/subscribe';
    const batchSize = this.options.resubscribeBatchSize ?? DEFAULT_RESUBSCRIBE_BATCH_SIZE;
    const delayMs = this.options.resubscribeBatchDelayMs ?? DEFAULT_RESUBSCRIBE_BATCH_DELAY_MS;
    const channels = [...this.subscribedChannels.values()];
    const batches = Math.ceil(channels.length / batchSize);
    this.log.info(
      { count: channels.length, batches, batchSize, delayMs },
      're-subscribing to channels',
    );

    for (let i = 0; i < channels.length; i += batchSize) {
      const batch = channels.slice(i, i + batchSize);
      await this.call(method, { channels: batch });
      if (i + batchSize < channels.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private cleanup(): void {
    this.heartbeatToken += 1;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error(`[${this.label}] connection closed`));
    }
    this.pending.clear();
  }

  private remainingRateLimitCooldownMs(): number {
    return Math.max(0, this.rateLimitUntil - Date.now());
  }

  private noteRateLimit(error: unknown): void {
    if (!isRateLimitSignal(error)) return;

    const cooldownMs = this.options.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    const maxTotalMs = this.options.maxCooldownTotalMs ?? DEFAULT_MAX_COOLDOWN_TOTAL_MS;
    const now = Date.now();
    if (this.rateLimitFirstHitAt === 0) this.rateLimitFirstHitAt = now;

    const proposed = now + cooldownMs;
    const ceiling = this.rateLimitFirstHitAt + maxTotalMs;
    const until = Math.min(proposed, ceiling);
    if (until > this.rateLimitUntil) this.rateLimitUntil = until;

    this.rateLimitHits += 1;
    this.log.warn(
      {
        cooldownMs,
        rateLimitHits: this.rateLimitHits,
        retryAt: this.rateLimitUntil,
        ceilingHit: until < proposed,
      },
      'rate limit detected, delaying reconnects',
    );
  }
}
