import { z } from 'zod';
import { DERIVE_WS_URL } from '../shared/endpoints.js';
import { JsonRpcWsClient } from '../shared/jsonrpc-client.js';
import {
  DepthPairsSchema,
  DepthSequenceSchema,
  PublicDepthError,
  depthPairs,
  type NativeDepthSnapshot,
} from '../shared/public-depth.js';

const Schema = z.object({
  instrument_name: z.string(),
  timestamp: z.number().int().nonnegative(),
  publish_id: DepthSequenceSchema,
  bids: DepthPairsSchema,
  asks: DepthPairsSchema,
});
interface Entry {
  book: NativeDepthSnapshot | null;
  idle: ReturnType<typeof setTimeout> | null;
  pending: {
    promise: Promise<NativeDepthSnapshot>;
    resolve(book: NativeDepthSnapshot): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  } | null;
}

export class DerivePublicDepth {
  private readonly entries = new Map<string, Entry>();
  private readonly rpc: JsonRpcWsClient;
  private generation = 1;
  private disposed = false;

  constructor(private readonly now: () => number = Date.now) {
    this.rpc = new JsonRpcWsClient(DERIVE_WS_URL, 'derive-public-depth', {
      subscribeMethod: 'subscribe',
      unsubscribeMethod: 'unsubscribe',
      handshakeTimeoutMs: 5000,
      requestTimeoutMs: 5000,
      onStatusChange: (state) => {
        if (state === 'connected') return;
        this.generation++;
        for (const entry of this.entries.values()) {
          entry.book = null;
          this.fail(entry);
        }
      },
    });
    this.rpc.onSubscription((channel, raw) => {
      const symbol = channel.split('.').slice(1, -2).join('.');
      const entry = this.entries.get(symbol);
      if (!entry || !channel.startsWith('orderbook.')) return;
      const parsed = Schema.safeParse(raw);
      if (!parsed.success || parsed.data.instrument_name !== symbol) {
        this.fail(entry, 'invalid-book');
        return;
      }
      const data = parsed.data;
      const receivedAt = this.now();
      entry.book = {
        bids: depthPairs(data.bids),
        asks: depthPairs(data.asks),
        exchangeTs: data.timestamp,
        lastChangeAt: data.timestamp,
        sequence: data.publish_id,
        sourceMaxLevels: 10,
        priceCurrency: 'USDC',
        exchangeTimestampBasis: 'generation',
        requestedAt: receivedAt,
        receivedAt,
        connectionGeneration: this.generation,
      };
      if (entry.pending) {
        clearTimeout(entry.pending.timer);
        entry.pending.resolve(entry.book);
        entry.pending = null;
      }
    });
  }

  snapshot(symbol: string): Promise<NativeDepthSnapshot> {
    if (this.disposed) return Promise.reject(new PublicDepthError('disposed'));
    let entry = this.entries.get(symbol);
    if (!entry) {
      if (this.entries.size >= 40) return Promise.reject(new PublicDepthError('capacity'));
      entry = { book: null, idle: null, pending: null };
      this.entries.set(symbol, entry);
    }
    if (entry.idle) clearTimeout(entry.idle);
    const current = entry;
    current.idle = setTimeout(() => {
      this.entries.delete(symbol);
      this.fail(current);
      void this.rpc.unsubscribe([`orderbook.${symbol}.1.10`]).catch(() => {});
      if (this.entries.size === 0) void this.rpc.disconnect();
    }, 30_000);
    current.idle.unref();
    if (current.book && this.rpc.isConnected) return Promise.resolve(current.book);
    if (current.pending) return current.pending.promise;
    let resolve!: (book: NativeDepthSnapshot) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<NativeDepthSnapshot>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(() => this.fail(current), 5000);
    current.pending = { promise, resolve, reject, timer };
    void this.rpc
      .connect()
      .then(() => this.rpc.subscribe([`orderbook.${symbol}.1.10`], 'bot-public-depth'))
      .catch(() => this.fail(current));
    return promise;
  }

  private fail(
    entry: Entry,
    reason: 'upstream-timeout' | 'invalid-book' = 'upstream-timeout',
  ): void {
    if (!entry.pending) return;
    clearTimeout(entry.pending.timer);
    entry.pending.reject(new PublicDepthError(reason));
    entry.pending = null;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.idle) clearTimeout(entry.idle);
      this.fail(entry);
    }
    this.entries.clear();
    await this.rpc.disconnect();
  }
}
