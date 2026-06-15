import type {
  ChainRuntimeEvent,
  ChainRuntimeSnapshotEvent,
  ChainRuntimeListener,
  ServerWsMessage,
  VenueFailure,
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
const LARGE_FRAME_BYTES = 250_000;
const LARGE_FRAME_LOG_TTL_MS = 5_000;
const SOFT_BACKPRESSURE_BYTES = 500_000;
const GEX_DELTA_MIN_INTERVAL_MS = 2_000;

function normalizeStatusMessage(message?: string): string {
  if (message == null) return '';
  return message
    .replace(/stale for \d+ms/g, 'stale for <ms>')
    .replace(/\b\d+ms\b/g, '<ms>')
    .replace(/\b\d+s\b/g, '<s>');
}

interface SessionLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

interface SessionRuntime {
  subscribe: (listener: ChainRuntimeListener) => () => void;
  getSnapshot: () => ChainRuntimeSnapshotEvent | null;
  getActiveRequest: () => WsSubscriptionRequest;
  getFailedVenues: () => VenueFailure[];
}

type SessionSocket = {
  readyState: number;
  send: (data: string) => void;
  close?: (code?: number, reason?: string) => void;
  bufferedAmount?: number;
};

export class ChainStreamSession {
  private detachEngineListener: (() => void) | null = null;
  private releaseEngine: (() => Promise<void>) | null = null;
  private disposed = false;
  private initialized = false;
  private lastSentSeq = 0;
  private bufferedEvents: ChainRuntimeEvent[] = [];
  private engineListener: ChainRuntimeListener | null = null;
  private slowClientSince: number | null = null;
  private lastLargeFrameLoggedAt = 0;
  private lastGexSentAt = 0;
  private readonly lastVenueStatusByVenue = new Map<string, string>();
  private runtime: SessionRuntime | null = null;
  private needsResync = false;

  constructor(
    private readonly socket: SessionSocket,
    private subscriptionId: string,
    readonly request: WsSubscriptionRequest,
    private readonly log?: SessionLogger,
  ) {}

  async subscribe(): Promise<void> {
    const acquired = await chainEngines.acquire(this.request);
    if (this.disposed) {
      await acquired.release();
      return;
    }

    this.runtime = acquired.runtime as SessionRuntime;
    this.releaseEngine = acquired.release;
    this.engineListener = {
      onEvent: (event) => this.handleEngineEvent(event),
    };
    this.detachEngineListener = acquired.runtime.subscribe(this.engineListener);

    this.sendMessage('subscribed', {
      type: 'subscribed',
      subscriptionId: this.subscriptionId,
      request: acquired.runtime.getActiveRequest(),
      serverTime: Date.now(),
      failedVenues:
        acquired.runtime.getFailedVenues().length > 0 ? acquired.runtime.getFailedVenues() : undefined,
    });

    const snapshot = acquired.runtime.getSnapshot();
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
    this.lastVenueStatusByVenue.clear();
    this.runtime = null;
    this.needsResync = false;
    this.lastGexSentAt = 0;

    const release = this.releaseEngine;
    this.releaseEngine = null;
    if (release != null) {
      await release();
    }
  }

  replaceSubscription(subscriptionId: string): void {
    if (this.disposed) return;
    this.subscriptionId = subscriptionId;
    this.lastSentSeq = 0;
    this.lastVenueStatusByVenue.clear();

    this.sendMessage('subscribed', {
      type: 'subscribed',
      subscriptionId: this.subscriptionId,
      request: this.runtime?.getActiveRequest() ?? this.request,
      serverTime: Date.now(),
      failedVenues:
        this.runtime != null && this.runtime.getFailedVenues().length > 0
          ? this.runtime.getFailedVenues()
          : undefined,
    });

    const snapshot = this.runtime?.getSnapshot();
    if (snapshot != null) {
      this.sendEngineEvent(snapshot);
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
    if (this.needsResync && !this.isBackpressured()) {
      this.flushResyncSnapshot();
      if (this.disposed) return;
    }
    if (this.isSlowClient(now)) {
      this.disposeForSlowClient();
      return;
    }

    switch (event.type) {
      case 'snapshot':
        this.lastSentSeq = event.seq;
        this.lastGexSentAt = now;
        this.sendMessage('snapshot', {
          type: 'snapshot',
          subscriptionId: this.subscriptionId,
          seq: event.seq,
          request: event.request,
          meta: event.meta,
          data: event.data,
        });
        this.trackBackpressure(now, 'snapshot');
        return;

      case 'delta':
        if (this.shouldDeferDelta()) {
          this.needsResync = true;
          return;
        }
        const includeGex = now - this.lastGexSentAt >= GEX_DELTA_MIN_INTERVAL_MS;
        if (includeGex) this.lastGexSentAt = now;
        this.lastSentSeq = event.seq;
        this.sendMessage('delta', {
          type: 'delta',
          subscriptionId: this.subscriptionId,
          seq: event.seq,
          request: event.request,
          meta: event.meta,
          patch: includeGex ? event.patch : { stats: event.patch.stats, strikes: event.patch.strikes },
        });
        this.trackBackpressure(now, 'delta');
        return;

      case 'status':
        const statusKey = `${event.status.state}:${normalizeStatusMessage(event.status.message)}`;
        const previousStatusKey = this.lastVenueStatusByVenue.get(event.status.venue);
        this.lastVenueStatusByVenue.set(event.status.venue, statusKey);
        if (event.status.state !== 'connected' && previousStatusKey !== statusKey) {
          this.log?.warn(
            {
              subscriptionId: this.subscriptionId,
              underlying: this.request.underlying,
              expiry: this.request.expiry,
              venue: event.status.venue,
              state: event.status.state,
              message: event.status.message,
            },
            'chain ws venue status',
          );
        }
        this.sendMessage('status', {
          type: 'status',
          subscriptionId: this.subscriptionId,
          venue: event.status.venue,
          state: event.status.state,
          ts: event.status.ts,
          message: event.status.message,
        });
        this.trackBackpressure(now, 'status');
        return;
    }
  }

  private sendMessage(kind: 'subscribed' | 'snapshot' | 'delta' | 'status', message: ServerWsMessage): void {
    if (this.socket.readyState !== WS_OPEN) return;

    const payload = JSON.stringify(message);
    this.socket.send(payload);

    const bytes = Buffer.byteLength(payload);
    if (
      (kind === 'snapshot' || kind === 'delta') &&
      bytes >= LARGE_FRAME_BYTES &&
      Date.now() - this.lastLargeFrameLoggedAt >= LARGE_FRAME_LOG_TTL_MS
    ) {
      this.lastLargeFrameLoggedAt = Date.now();
      const staleMs = 'meta' in message ? message.meta.staleMs : undefined;
      this.log?.info(
        {
          subscriptionId: this.subscriptionId,
          underlying: this.request.underlying,
          expiry: this.request.expiry,
          frameType: kind,
          bytes,
          staleMs,
          bufferedAmount: this.socket.bufferedAmount ?? 0,
        },
        'chain ws large frame',
      );
    }
  }

  private shouldDeferDelta(): boolean {
    return (this.socket.bufferedAmount ?? 0) >= SOFT_BACKPRESSURE_BYTES;
  }

  private isBackpressured(): boolean {
    return (this.socket.bufferedAmount ?? 0) >= SOFT_BACKPRESSURE_BYTES;
  }

  private flushResyncSnapshot(): void {
    const snapshot = this.runtime?.getSnapshot();
    if (snapshot == null) return;
    this.needsResync = false;
    this.lastSentSeq = snapshot.seq;
    this.lastGexSentAt = Date.now();
    this.sendMessage('snapshot', {
      type: 'snapshot',
      subscriptionId: this.subscriptionId,
      seq: snapshot.seq,
      request: snapshot.request,
      meta: snapshot.meta,
      data: snapshot.data,
    });
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

  private trackBackpressure(now: number, frameType: 'snapshot' | 'delta' | 'status'): void {
    const bufferedAmount = this.socket.bufferedAmount ?? 0;
    if (bufferedAmount < MAX_SOCKET_BUFFERED_BYTES) {
      this.slowClientSince = null;
      return;
    }
    if (this.slowClientSince == null) {
      this.log?.warn(
        {
          subscriptionId: this.subscriptionId,
          underlying: this.request.underlying,
          expiry: this.request.expiry,
          frameType,
          bufferedAmount,
          thresholdBytes: MAX_SOCKET_BUFFERED_BYTES,
        },
        'chain ws backpressure started',
      );
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
    this.lastVenueStatusByVenue.clear();
    this.runtime = null;
    this.needsResync = false;
    this.lastGexSentAt = 0;
    this.log?.warn(
      {
        subscriptionId: this.subscriptionId,
        underlying: this.request.underlying,
        expiry: this.request.expiry,
        bufferedAmount: this.socket.bufferedAmount ?? 0,
      },
      'chain ws slow client closed',
    );
    this.socket.close?.(1013, 'slow client');

    const release = this.releaseEngine;
    this.releaseEngine = null;
    if (release != null) {
      void release();
    }
  }
}
