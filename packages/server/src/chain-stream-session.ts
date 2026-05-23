import type {
  ChainRuntimeEvent,
  ChainRuntimeListener,
  ServerWsMessage,
  WsSubscriptionRequest,
} from '@oggregator/core';
import { chainEngines } from './chain-engines.js';

// WebSocket.OPEN is 1 per RFC 6455 — duck-typed socket interface doesn't carry the constant
const WS_OPEN = 1;
const MAX_SOCKET_BUFFERED_BYTES = 1_000_000;
// Older expiries can produce a multi-message burst (ack + snapshot + status)
// before the browser drains the first frame. Only treat backpressure as fatal
// if it persists beyond a short grace window.
const SLOW_CLIENT_GRACE_MS = 15_000;

type SessionSocket = {
  readyState: number;
  send: (data: string) => void;
  close?: (code?: number, reason?: string) => void;
  bufferedAmount?: number;
};

function send(socket: SessionSocket, message: ServerWsMessage): void {
  if (socket.readyState === WS_OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export class ChainStreamSession {
  private detachEngineListener: (() => void) | null = null;
  private releaseEngine: (() => Promise<void>) | null = null;
  private disposed = false;
  private initialized = false;
  private lastSentSeq = 0;
  private bufferedEvents: ChainRuntimeEvent[] = [];
  private engineListener: ChainRuntimeListener | null = null;
  private slowClientSince: number | null = null;

  constructor(
    private readonly socket: SessionSocket,
    readonly subscriptionId: string,
    readonly request: WsSubscriptionRequest,
  ) {}

  async subscribe(): Promise<void> {
    const { runtime, release } = await chainEngines.acquire(this.request);
    if (this.disposed) {
      await release();
      return;
    }

    this.releaseEngine = release;
    this.engineListener = {
      onEvent: (event) => this.handleEngineEvent(event),
    };
    this.detachEngineListener = runtime.subscribe(this.engineListener);

    send(this.socket, {
      type: 'subscribed',
      subscriptionId: this.subscriptionId,
      request: runtime.getActiveRequest(),
      serverTime: Date.now(),
      failedVenues: runtime.getFailedVenues().length > 0 ? runtime.getFailedVenues() : undefined,
    });

    const snapshot = runtime.getSnapshot();
    if (snapshot != null) {
      this.sendEngineEvent(snapshot);
    }

    this.initialized = true;
    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const event of buffered) {
      this.sendEngineEvent(event);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.detachEngineListener?.();
    this.detachEngineListener = null;
    this.engineListener = null;
    this.bufferedEvents = [];
    this.slowClientSince = null;

    const release = this.releaseEngine;
    this.releaseEngine = null;
    if (release != null) {
      await release();
    }
  }

  private handleEngineEvent(event: ChainRuntimeEvent): void {
    if (this.disposed) return;
    if (!this.initialized) {
      if (event.type === 'snapshot') {
        this.bufferedEvents = this.bufferedEvents.filter(
          (buffered) => buffered.type !== 'snapshot',
        );
      }
      this.bufferedEvents.push(event);
      return;
    }

    this.sendEngineEvent(event);
  }

  private sendEngineEvent(event: ChainRuntimeEvent): void {
    if (this.disposed) return;
    if ((event.type === 'snapshot' || event.type === 'delta') && event.seq <= this.lastSentSeq) {
      return;
    }
    const now = Date.now();
    if (this.isSlowClient(now)) {
      this.disposeForSlowClient();
      return;
    }

    switch (event.type) {
      case 'snapshot':
        this.lastSentSeq = event.seq;
        send(this.socket, {
          type: 'snapshot',
          subscriptionId: this.subscriptionId,
          seq: event.seq,
          request: event.request,
          meta: event.meta,
          data: event.data,
        });
        this.trackBackpressure(now);
        return;

      case 'delta':
        this.lastSentSeq = event.seq;
        send(this.socket, {
          type: 'delta',
          subscriptionId: this.subscriptionId,
          seq: event.seq,
          request: event.request,
          meta: event.meta,
          deltas: event.deltas,
          patch: event.patch,
        });
        this.trackBackpressure(now);
        return;

      case 'status':
        send(this.socket, {
          type: 'status',
          subscriptionId: this.subscriptionId,
          venue: event.status.venue,
          state: event.status.state,
          ts: event.status.ts,
          message: event.status.message,
        });
        this.trackBackpressure(now);
        return;
    }
  }

  private isSlowClient(now: number): boolean {
    const bufferedAmount = this.socket.bufferedAmount ?? 0;
    if (bufferedAmount < MAX_SOCKET_BUFFERED_BYTES) {
      this.slowClientSince = null;
      return false;
    }
    if (this.slowClientSince == null) {
      this.slowClientSince = now;
      return false;
    }
    return now - this.slowClientSince >= SLOW_CLIENT_GRACE_MS;
  }

  private trackBackpressure(now: number): void {
    const bufferedAmount = this.socket.bufferedAmount ?? 0;
    if (bufferedAmount < MAX_SOCKET_BUFFERED_BYTES) {
      this.slowClientSince = null;
      return;
    }
    this.slowClientSince ??= now;
  }

  private disposeForSlowClient(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachEngineListener?.();
    this.detachEngineListener = null;
    this.engineListener = null;
    this.bufferedEvents = [];
    this.slowClientSince = null;
    this.socket.close?.(1013, 'slow client');

    const release = this.releaseEngine;
    this.releaseEngine = null;
    if (release != null) {
      void release();
    }
  }
}
