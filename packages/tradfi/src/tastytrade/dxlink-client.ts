import { TopicWsClient } from '@oggregator/core';
import type WebSocket from 'ws';
import {
  buildAuth, buildChannelRequest, buildFeedSetup, buildKeepalive, buildSetup, buildSubscribeFrames,
  parseFeedData, type DxEvent, type DxSub,
} from './codec.js';
import { feedLogger } from '../logger.js';

const log = feedLogger('dxlink');

// DXLink answers subscription bursts with BAD_ACTION "subscription rate is too high" and
// drops them, so frames (≤500 subs each) leave one per interval: ≤5k subs/s.
export const SUBSCRIBE_FRAME_INTERVAL_MS = 100;

export interface DxLinkProtocolOptions {
  channel: number;
  token: string;
  send: (msg: unknown) => void;
  onData: (events: DxEvent[]) => void;
  desiredSubs: () => DxSub[];
  /** Fired when the server rejects our token or reports a protocol error. */
  onAuthError?: (() => void) | undefined;
  /** Fired when DXLink refuses a subscription change (size or rate limit). */
  onSubscriptionRejected?: ((detail: string) => void) | undefined;
}

type SubscribeFrame = ReturnType<typeof buildSubscribeFrames>[number];

export class DxLinkProtocol {
  private ready = false;
  private sentAuth = false;
  private queue: SubscribeFrame[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly o: DxLinkProtocolOptions) {}

  isReady(): boolean {
    return this.ready;
  }

  onOpen(): void {
    this.ready = false;
    this.sentAuth = false;
    this.clearQueue();
    this.o.send(buildSetup());
  }

  onMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg == null) return;
    const m = msg as { type?: string; state?: string; error?: string; message?: string };
    switch (m.type) {
      case 'AUTH_STATE':
        if (m.state === 'UNAUTHORIZED') {
          // A second UNAUTHORIZED after we already sent AUTH means the token was rejected.
          if (this.sentAuth) { this.o.onAuthError?.(); return; }
          this.sentAuth = true;
          this.o.send(buildAuth(this.o.token));
        } else if (m.state === 'AUTHORIZED') {
          this.sentAuth = false;
          this.o.send(buildChannelRequest(this.o.channel));
        }
        return;
      case 'ERROR':
        // Only a token rejection warrants a token-refresh reconnect. Other errors
        // (INVALID_MESSAGE, TIMEOUT, …) are logged — reconnecting on them storms.
        if (m.error === 'UNAUTHORIZED') {
          log.warn({ error: m.error }, 'dxlink auth error');
          this.o.onAuthError?.();
        } else if (m.error === 'BAD_ACTION' && /subscription/i.test(m.message ?? '')) {
          log.warn({ error: m.error, detail: m.message }, 'dxlink subscription rejected');
          this.o.onSubscriptionRejected?.(m.message ?? '');
        } else {
          log.warn({ error: m.error, detail: m.message }, 'dxlink protocol error');
        }
        return;
      case 'CHANNEL_OPENED':
        this.o.send(buildFeedSetup(this.o.channel));
        return;
      case 'FEED_CONFIG': {
        // DXLink re-sends FEED_CONFIG after subscription changes; resend the full set only once
        // per connection, or every new chain re-sends everything.
        if (this.ready) return;
        this.ready = true;
        this.send(this.o.desiredSubs(), 'add');
        return;
      }
      case 'FEED_DATA': {
        const events = parseFeedData(msg);
        if (events.length > 0) this.o.onData(events);
        return;
      }
      default:
        return;
    }
  }

  subscribe(subs: DxSub[]): void {
    if (this.ready) this.send(subs, 'add');
  }

  unsubscribe(subs: DxSub[]): void {
    if (this.ready) this.send(subs, 'remove');
  }

  /** Re-send the whole desired set; DXLink treats adds of live subscriptions as no-ops. */
  resubscribeAll(): void {
    if (this.ready) this.send(this.o.desiredSubs(), 'add');
  }

  dispose(): void {
    this.clearQueue();
  }

  private send(subs: DxSub[], action: 'add' | 'remove'): void {
    if (subs.length === 0) return;
    this.queue.push(...buildSubscribeFrames(this.o.channel, subs, action));
    this.drain();
  }

  private drain(): void {
    if (this.drainTimer != null) return;
    const frame = this.queue.shift();
    if (frame == null) return;
    this.o.send(frame);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();
    }, SUBSCRIBE_FRAME_INTERVAL_MS);
  }

  private clearQueue(): void {
    this.queue = [];
    if (this.drainTimer != null) clearTimeout(this.drainTimer);
    this.drainTimer = null;
  }
}

export interface DxLinkClientOptions {
  url: string;
  token: string;
  onData: (events: DxEvent[]) => void;
  desiredSubs: () => DxSub[];
  onAuthError?: (() => void) | undefined;
  onSubscriptionRejected?: ((detail: string) => void) | undefined;
}

const CHANNEL = 3;

export class DxLinkClient {
  private ws: TopicWsClient | null = null;
  private proto: DxLinkProtocol | null = null;

  constructor(private readonly o: DxLinkClientOptions) {}

  async connect(): Promise<void> {
    const proto = new DxLinkProtocol({
      channel: CHANNEL,
      token: this.o.token,
      send: (m) => this.ws?.send(m as Record<string, unknown>),
      onData: this.o.onData,
      desiredSubs: this.o.desiredSubs,
      onAuthError: this.o.onAuthError,
      onSubscriptionRejected: this.o.onSubscriptionRejected,
    });
    this.proto = proto;

    this.ws = new TopicWsClient(this.o.url, 'tradfi-dxlink', {
      pingIntervalMs: 30_000,
      pingMessage: buildKeepalive(),
      onOpen: () => proto.onOpen(),
      onMessage: (raw: WebSocket.RawData) => {
        try {
          proto.onMessage(JSON.parse(raw.toString()));
        } catch (err: unknown) {
          log.debug({ err: String(err) }, 'bad dxlink frame');
        }
      },
      onStatusChange: (state) => log.info({ state }, 'dxlink status'),
    });
    await this.ws.connect();
  }

  isStreaming(): boolean {
    return this.proto?.isReady() ?? false;
  }

  subscribe(subs: DxSub[]): void {
    this.proto?.subscribe(subs);
  }

  unsubscribe(subs: DxSub[]): void {
    this.proto?.unsubscribe(subs);
  }

  resubscribeAll(): void {
    this.proto?.resubscribeAll();
  }

  async disconnect(): Promise<void> {
    this.proto?.dispose();
    await this.ws?.disconnect();
    this.ws = null;
    this.proto = null;
  }
}
