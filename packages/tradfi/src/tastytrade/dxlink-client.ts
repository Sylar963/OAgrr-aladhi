import { TopicWsClient } from '@oggregator/core';
import type WebSocket from 'ws';
import {
  buildAuth, buildChannelRequest, buildFeedSetup, buildKeepalive, buildSetup, buildSubscribe,
  parseFeedData, type DxEvent, type DxSub,
} from './codec.js';
import { feedLogger } from '../logger.js';

const log = feedLogger('dxlink');

export interface DxLinkProtocolOptions {
  channel: number;
  token: string;
  send: (msg: unknown) => void;
  onData: (events: DxEvent[]) => void;
  desiredSubs: () => DxSub[];
  /** Fired when the server rejects our token or reports a protocol error. */
  onAuthError?: (() => void) | undefined;
}

export class DxLinkProtocol {
  private ready = false;
  private sentAuth = false;
  constructor(private readonly o: DxLinkProtocolOptions) {}

  isReady(): boolean {
    return this.ready;
  }

  onOpen(): void {
    this.ready = false;
    this.sentAuth = false;
    this.o.send(buildSetup());
  }

  onMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg == null) return;
    const m = msg as { type?: string; state?: string; error?: string };
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
        } else {
          log.warn({ error: m.error }, 'dxlink protocol error');
        }
        return;
      case 'CHANNEL_OPENED':
        this.o.send(buildFeedSetup(this.o.channel));
        return;
      case 'FEED_CONFIG': {
        this.ready = true;
        const subs = this.o.desiredSubs();
        if (subs.length > 0) this.o.send(buildSubscribe(this.o.channel, subs, 'add'));
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
    if (this.ready && subs.length > 0) this.o.send(buildSubscribe(this.o.channel, subs, 'add'));
  }

  unsubscribe(subs: DxSub[]): void {
    if (this.ready && subs.length > 0) this.o.send(buildSubscribe(this.o.channel, subs, 'remove'));
  }
}

export interface DxLinkClientOptions {
  url: string;
  token: string;
  onData: (events: DxEvent[]) => void;
  desiredSubs: () => DxSub[];
  onAuthError?: (() => void) | undefined;
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

  async disconnect(): Promise<void> {
    await this.ws?.disconnect();
    this.ws = null;
    this.proto = null;
  }
}
