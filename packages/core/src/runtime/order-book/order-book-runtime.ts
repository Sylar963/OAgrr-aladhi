import { Worker } from 'node:worker_threads';
import type { BookFeedStatus, ThalexBookAuth } from '../../feeds/thalex/book-feed.js';
import type { OrderBookSnapshot } from '../../liquidity/types.js';
import { feedLogger } from '../../utils/logger.js';
import type { OrderBookPort, OrderBookWorkerEvent, OrderBookWorkerRequest } from './worker-protocol.js';

const log = feedLogger('order-book');
const DEFAULT_LINGER_MS = 60_000;
const DEFAULT_MAX_INSTRUMENTS = 40;
const DEFAULT_RESPAWN_DELAY_MS = 2_000;

export interface OrderBookWorkerHandle {
  port: OrderBookPort;
  terminate(): Promise<unknown>;
  onExit(listener: (code: number) => void): void;
}

function spawnOrderBookWorker(): OrderBookWorkerHandle {
  const worker = new Worker(new URL('./worker.js', import.meta.url));
  // An 'error' event with no listener would be rethrown on the main thread.
  worker.on('error', (error) => log.error({ err: String(error) }, 'order-book worker crashed'));
  return {
    port: worker,
    terminate: () => worker.terminate(),
    onExit: (listener) => worker.on('exit', listener),
  };
}

export class OrderBookCapacityError extends Error {
  constructor(max: number) {
    super(`Order-book runtime is at its limit of ${max} instruments`);
    this.name = 'OrderBookCapacityError';
  }
}

export class OrderBookUnavailableError extends Error {
  constructor(
    readonly instrument: string,
    readonly reason: 'rejected' | 'timeout' | 'disposed',
  ) {
    super(`Order book for ${instrument} is unavailable (${reason})`);
    this.name = 'OrderBookUnavailableError';
  }
}

export interface OrderBookLease {
  release(): void;
}

export interface OrderBookRuntimeOptions {
  spawn?: () => OrderBookWorkerHandle;
  lingerMs?: number;
  maxInstruments?: number;
  respawnDelayMs?: number;
}

interface Waiter {
  resolve(book: OrderBookSnapshot): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Main-thread side of the Thalex L2 books. The socket and all frame parsing live on a dedicated
 * worker; this side holds the latest snapshot per instrument and ref-counts subscriptions.
 * Released instruments linger before unsubscribing, so polling doesn't churn the venue.
 */
export class OrderBookRuntime {
  private readonly spawn: () => OrderBookWorkerHandle;
  private readonly lingerMs: number;
  private readonly maxInstruments: number;
  private readonly respawnDelayMs: number;
  private readonly refs = new Map<string, number>();
  private readonly lingering = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly books = new Map<string, OrderBookSnapshot>();
  private readonly rejected = new Set<string>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private handle: OrderBookWorkerHandle | null = null;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private feedStatus: BookFeedStatus | 'idle' = 'idle';
  private auth: ThalexBookAuth | null = null;
  private disposed = false;

  constructor(options: OrderBookRuntimeOptions = {}) {
    this.spawn = options.spawn ?? spawnOrderBookWorker;
    this.lingerMs = options.lingerMs ?? DEFAULT_LINGER_MS;
    this.maxInstruments = options.maxInstruments ?? DEFAULT_MAX_INSTRUMENTS;
    this.respawnDelayMs = options.respawnDelayMs ?? DEFAULT_RESPAWN_DELAY_MS;
  }

  get status(): BookFeedStatus | 'idle' {
    return this.feedStatus;
  }

  /** Instruments currently subscribed, held or lingering. */
  instruments(): string[] {
    return [...this.held()];
  }

  acquire(instrument: string): OrderBookLease {
    if (this.disposed) throw new OrderBookUnavailableError(instrument, 'disposed');
    const linger = this.lingering.get(instrument);
    if (linger !== undefined) {
      clearTimeout(linger);
      this.lingering.delete(instrument);
    } else if (!this.refs.has(instrument)) {
      this.makeRoom();
      this.rejected.delete(instrument);
      this.send({ t: 'add', instrument });
    }
    this.refs.set(instrument, (this.refs.get(instrument) ?? 0) + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.release(instrument);
      },
    };
  }

  /**
   * Logs the book socket in so it is not counted against Thalex's per-IP cap on
   * unauthenticated sockets. Null goes back to an anonymous socket.
   */
  setAuth(auth: ThalexBookAuth | null): void {
    if (this.disposed) return;
    this.auth = auth;
    // Refusals under the old session say nothing about the new one.
    this.rejected.clear();
    this.handle?.port.postMessage({ t: 'auth', auth } satisfies OrderBookWorkerRequest);
  }

  getBook(instrument: string): OrderBookSnapshot | null {
    return this.books.get(instrument) ?? null;
  }

  /** Thalex acknowledged the subscribe but left this instrument out (not listed). */
  isRejected(instrument: string): boolean {
    return this.rejected.has(instrument);
  }

  /** Resolves with the first synced book; rejects if Thalex refuses the instrument or on timeout. */
  waitForBook(instrument: string, timeoutMs: number): Promise<OrderBookSnapshot> {
    const current = this.books.get(instrument);
    if (current?.state === 'synced') return Promise.resolve(current);
    if (this.rejected.has(instrument)) {
      return Promise.reject(new OrderBookUnavailableError(instrument, 'rejected'));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.get(instrument)?.delete(waiter);
          reject(new OrderBookUnavailableError(instrument, 'timeout'));
        }, timeoutMs),
      };
      let set = this.waiters.get(instrument);
      if (!set) {
        set = new Set();
        this.waiters.set(instrument, set);
      }
      set.add(waiter);
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.respawnTimer !== null) clearTimeout(this.respawnTimer);
    this.respawnTimer = null;
    for (const timer of this.lingering.values()) clearTimeout(timer);
    this.lingering.clear();
    for (const instrument of this.waiters.keys()) this.failWaiters(instrument, 'disposed');
    const handle = this.handle;
    this.handle = null;
    if (handle) {
      handle.port.postMessage({ t: 'stop' } satisfies OrderBookWorkerRequest);
      await handle.terminate();
    }
  }

  private held(): Set<string> {
    return new Set([...this.refs.keys(), ...this.lingering.keys()]);
  }

  /** At the cap, evict the oldest lingering instrument; if every slot is in use, refuse. */
  private makeRoom(): void {
    if (this.held().size < this.maxInstruments) return;
    const oldest = this.lingering.keys().next();
    if (oldest.done) throw new OrderBookCapacityError(this.maxInstruments);
    this.unsubscribe(oldest.value);
  }

  private release(instrument: string): void {
    const count = (this.refs.get(instrument) ?? 0) - 1;
    if (count > 0) {
      this.refs.set(instrument, count);
      return;
    }
    this.refs.delete(instrument);
    if (this.disposed) return;
    this.lingering.set(
      instrument,
      setTimeout(() => this.unsubscribe(instrument), this.lingerMs),
    );
  }

  private unsubscribe(instrument: string): void {
    const timer = this.lingering.get(instrument);
    if (timer !== undefined) clearTimeout(timer);
    this.lingering.delete(instrument);
    this.books.delete(instrument);
    this.rejected.delete(instrument);
    this.send({ t: 'remove', instrument });
  }

  private send(message: OrderBookWorkerRequest): void {
    if (this.disposed) return;
    if (!this.handle && this.respawnTimer === null) this.launch();
    this.handle?.port.postMessage(message);
  }

  private launch(): void {
    const handle = this.spawn();
    this.handle = handle;
    if (this.auth != null) {
      handle.port.postMessage({ t: 'auth', auth: this.auth } satisfies OrderBookWorkerRequest);
    }
    handle.port.on('message', (message) => this.receive(message as OrderBookWorkerEvent));
    handle.onExit((code) => {
      if (this.disposed || this.handle !== handle) return;
      this.handle = null;
      this.feedStatus = 'reconnecting';
      for (const [instrument, book] of this.books) {
        this.books.set(instrument, { ...book, state: 'unsynchronized', bids: [], asks: [] });
      }
      log.warn({ code }, 'order-book worker exited, respawning');
      this.respawnTimer = setTimeout(() => {
        this.respawnTimer = null;
        if (this.disposed) return;
        this.launch();
        for (const instrument of this.held()) {
          this.handle?.port.postMessage({ t: 'add', instrument } satisfies OrderBookWorkerRequest);
        }
      }, this.respawnDelayMs);
    });
  }

  private receive(event: OrderBookWorkerEvent): void {
    if (event.t === 'status') {
      this.feedStatus = event.status;
      return;
    }
    if (event.t === 'rejected') {
      this.rejected.add(event.instrument);
      this.failWaiters(event.instrument, 'rejected');
      return;
    }
    const { book } = event;
    if (!this.held().has(book.instrument)) return;
    this.books.set(book.instrument, book);
    if (book.state !== 'synced') return;
    const waiters = this.waiters.get(book.instrument);
    if (!waiters) return;
    this.waiters.delete(book.instrument);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(book);
    }
  }

  private failWaiters(instrument: string, reason: OrderBookUnavailableError['reason']): void {
    const waiters = this.waiters.get(instrument);
    if (!waiters) return;
    this.waiters.delete(instrument);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new OrderBookUnavailableError(instrument, reason));
    }
  }
}
