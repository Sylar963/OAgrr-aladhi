import {
  CANDLE_CHANNEL, buildCandleFeedSetup, buildCandleSubscribe, buildCandleUnsubscribe,
  parseCandleFrame, isSnapshotComplete, type RawCandle,
} from './candle-codec.js';
import { buildSetup, buildAuth, buildChannelRequest } from './codec.js';
import { feedLogger } from '../logger.js';

const log = feedLogger('tradfi-candles');

export interface CandleSocket {
  send(msg: unknown): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface CandleClientDeps {
  getToken: () => Promise<{ token: string; dxlinkUrl: string }>;
  socketFactory: (url: string) => CandleSocket;
  now?: () => number;
  requestTimeoutMs?: number;
}

interface Pending {
  buffer: RawCandle[];
  resolve: (b: RawCandle[]) => void;
  timer: ReturnType<typeof setTimeout>;
  candleSymbol: string;
}

export class CandleClient {
  private sock: CandleSocket | null = null;
  private ready = false;
  private sentAuth = false;
  private token = '';
  private readyWaiters: Array<() => void> = [];
  private pending = new Map<string, Pending>(); // keyed by candle symbol "SYM{=period}"
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(private readonly deps: CandleClientDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.timeoutMs = deps.requestTimeoutMs ?? 4000;
  }

  async connect(): Promise<void> {
    const { token, dxlinkUrl } = await this.deps.getToken();
    // Re-entrancy guard: tear down any prior socket so a repeat connect() (e.g. a
    // future reconnect) can't orphan it or leave stale ready-waiters queued.
    this.sock?.close();
    this.readyWaiters = [];
    this.token = token;
    this.ready = false;
    this.sentAuth = false;
    const sock = this.deps.socketFactory(dxlinkUrl);
    this.sock = sock;
    sock.onMessage((m) => this.onMessage(m));
    sock.onClose(() => { this.ready = false; });
    // Send SETUP only once the socket is open — sending on a CONNECTING ws throws.
    sock.onOpen(() => sock.send(buildSetup()));
  }

  isReady(): boolean { return this.ready; }

  private onMessage(msg: unknown): void {
    const m = msg as { type?: string; state?: string };
    switch (m.type) {
      case 'AUTH_STATE':
        if (m.state === 'UNAUTHORIZED' && !this.sentAuth) {
          this.sentAuth = true;
          this.sock?.send(buildAuth(this.token));
        } else if (m.state === 'AUTHORIZED') {
          this.sentAuth = false;
          this.sock?.send(buildChannelRequest(CANDLE_CHANNEL));
        }
        return;
      case 'CHANNEL_OPENED':
        this.sock?.send(buildCandleFeedSetup(CANDLE_CHANNEL));
        return;
      case 'FEED_CONFIG':
        this.ready = true;
        for (const w of this.readyWaiters.splice(0)) w();
        return;
      case 'FEED_DATA':
        this.onData(parseCandleFrame(msg));
        return;
      default:
        return;
    }
  }

  private onData(bars: RawCandle[]): void {
    for (const bar of bars) {
      // bar.symbol is the full candle symbol ("SYM{=period}") — match the pending
      // request exactly so concurrent same-strike/different-interval requests don't cross.
      const req = this.pending.get(bar.symbol);
      if (req === undefined) continue;
      if (Number.isFinite(bar.c) && Number.isFinite(bar.time)) req.buffer.push(bar);
      if (isSnapshotComplete(bar.flags)) this.finish(bar.symbol);
    }
  }

  private finish(candleSymbol: string): void {
    const req = this.pending.get(candleSymbol);
    if (!req) return;
    clearTimeout(req.timer);
    this.pending.delete(candleSymbol);
    this.sock?.send(buildCandleUnsubscribe(CANDLE_CHANNEL, candleSymbol));
    req.buffer.sort((a, b) => a.time - b.time);
    req.resolve(req.buffer);
  }

  getCandles(streamerSymbol: string, period: string, fromTimeSec: number): Promise<RawCandle[]> {
    const candleSymbol = `${streamerSymbol}{=${period}}`;
    if (this.pending.has(candleSymbol)) {
      // dedupe in-flight: return a promise that resolves when the existing request finishes
      return new Promise<RawCandle[]>((resolve) => {
        const existing = this.pending.get(candleSymbol)!;
        const orig = existing.resolve;
        existing.resolve = (bars) => { orig(bars); resolve(bars); };
      });
    }
    return new Promise<RawCandle[]>((resolve) => {
      const timer = setTimeout(() => this.finish(candleSymbol), this.timeoutMs);
      this.pending.set(candleSymbol, { buffer: [], resolve, timer, candleSymbol });
      // If the feed is already ready, subscribe immediately (synchronous) so the
      // pending entry is in place before any inbound data can arrive.
      // If not yet ready, wait — the subscribe will be sent once FEED_CONFIG arrives.
      if (this.ready) {
        this.sock?.send(buildCandleSubscribe(CANDLE_CHANNEL, candleSymbol, fromTimeSec));
      } else {
        this.readyWaiters.push(() => {
          if (this.pending.has(candleSymbol)) {
            this.sock?.send(buildCandleSubscribe(CANDLE_CHANNEL, candleSymbol, fromTimeSec));
          }
        });
      }
    });
  }

  dispose(): void {
    // Settle in-flight requests (empty, per the degradation contract) and clear
    // their timers so shutdown doesn't hang on a pending snapshot timeout.
    for (const req of this.pending.values()) { clearTimeout(req.timer); req.resolve([]); }
    this.pending.clear();
    this.readyWaiters = [];
    this.sock?.close();
    this.sock = null;
    this.ready = false;
    log.info('candle client disposed');
  }
}
