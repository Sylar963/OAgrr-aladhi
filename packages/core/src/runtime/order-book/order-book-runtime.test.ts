import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThalexBookAuth, ThalexBookFeedEvents } from '../../feeds/thalex/book-feed.js';
import type { OrderBookSnapshot } from '../../liquidity/types.js';
import {
  OrderBookCapacityError,
  OrderBookRuntime,
  OrderBookUnavailableError,
  type OrderBookWorkerHandle,
} from './order-book-runtime.js';
import { serveOrderBookWorker } from './worker-protocol.js';

function book(instrument: string, state: OrderBookSnapshot['state'] = 'synced'): OrderBookSnapshot {
  return {
    venue: 'thalex',
    instrument,
    priceUnit: 'usd',
    quantityUnit: 'base',
    bids: [{ price: 100, amount: 1, outrightAmount: 1 }],
    asks: [{ price: 101, amount: 1, outrightAmount: 1 }],
    totalBidAmount: 1,
    totalAskAmount: 1,
    exchangeTs: 1,
    receivedAt: 1,
    generation: 1,
    state,
    crossed: false,
    mark: null,
  };
}

interface FakeWorker {
  feed: {
    add: ReturnType<typeof vi.fn<(instrument: string) => void>>;
    remove: ReturnType<typeof vi.fn<(instrument: string) => void>>;
    setAuth: ReturnType<typeof vi.fn<(auth: ThalexBookAuth | null) => void>>;
    stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };
  events: ThalexBookFeedEvents;
  crash(): void;
}

function harness() {
  const workers: FakeWorker[] = [];
  const spawn = (): OrderBookWorkerHandle => {
    const { port1, port2 } = new MessageChannel();
    const exitListeners: Array<(code: number) => void> = [];
    const worker = {} as FakeWorker;
    serveOrderBookWorker(port2, (events) => {
      worker.events = events;
      worker.feed = {
        add: vi.fn<(instrument: string) => void>(),
        remove: vi.fn<(instrument: string) => void>(),
        setAuth: vi.fn<(auth: ThalexBookAuth | null) => void>(),
        stop: vi.fn<() => Promise<void>>(async () => {}),
      };
      return worker.feed;
    });
    worker.crash = () => {
      port1.close();
      port2.close();
      for (const listener of exitListeners) listener(1);
    };
    workers.push(worker);
    return {
      port: port1,
      terminate: async () => {
        port1.close();
        port2.close();
      },
      onExit: (listener) => exitListeners.push(listener),
    };
  };
  return { spawn, workers };
}

const flushPorts = () => new Promise((r) => setTimeout(r, 10));

const runtimes: OrderBookRuntime[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const r of runtimes.splice(0)) await r.dispose();
});

function create(options: ConstructorParameters<typeof OrderBookRuntime>[0] = {}) {
  const runtime = new OrderBookRuntime(options);
  runtimes.push(runtime);
  return runtime;
}

describe('OrderBookRuntime', () => {
  it('spawns lazily, subscribes once per instrument and resolves on the first synced book', async () => {
    const { spawn, workers } = harness();
    const runtime = create({ spawn });
    expect(workers).toHaveLength(0);

    const a = runtime.acquire('BTC-PERPETUAL');
    const b = runtime.acquire('BTC-PERPETUAL');
    const ready = runtime.waitForBook('BTC-PERPETUAL', 1_000);
    await flushPorts();
    expect(workers[0]!.feed.add).toHaveBeenCalledTimes(1);

    workers[0]!.events.onBook(book('BTC-PERPETUAL', 'uninitialized'));
    workers[0]!.events.onBook(book('BTC-PERPETUAL'));
    expect((await ready).state).toBe('synced');
    expect(runtime.getBook('BTC-PERPETUAL')?.state).toBe('synced');
    a.release();
    b.release();
  });

  it('lingers after the last release, and reuses the subscription if re-acquired', async () => {
    const { spawn, workers } = harness();
    const runtime = create({ spawn, lingerMs: 50 });
    runtime.acquire('BTC-PERPETUAL').release();
    runtime.acquire('BTC-PERPETUAL').release();
    await new Promise((r) => setTimeout(r, 120));

    expect(workers[0]!.feed.add).toHaveBeenCalledTimes(1);
    expect(workers[0]!.feed.remove).toHaveBeenCalledTimes(1);
    expect(runtime.instruments()).toEqual([]);
  });

  it('evicts a lingering instrument at the cap and refuses when every slot is in use', async () => {
    const { spawn, workers } = harness();
    const runtime = create({ spawn, maxInstruments: 2, lingerMs: 60_000 });
    runtime.acquire('A').release();
    runtime.acquire('B');
    runtime.acquire('C');
    await flushPorts();
    expect(workers[0]!.feed.remove).toHaveBeenCalledWith('A');
    expect(() => runtime.acquire('D')).toThrow(OrderBookCapacityError);
  });

  it('fails waiters fast when Thalex rejects the instrument', async () => {
    const { spawn, workers } = harness();
    const runtime = create({ spawn });
    runtime.acquire('BTC-01JAN20-1000-C');
    const waiting = runtime.waitForBook('BTC-01JAN20-1000-C', 5_000);
    await flushPorts();
    workers[0]!.events.onRejected!('BTC-01JAN20-1000-C');
    await expect(waiting).rejects.toMatchObject({ reason: 'rejected' });
    await expect(runtime.waitForBook('BTC-01JAN20-1000-C', 5_000)).rejects.toBeInstanceOf(
      OrderBookUnavailableError,
    );
  });

  it('times out when no synced book arrives', async () => {
    const { spawn } = harness();
    const runtime = create({ spawn });
    runtime.acquire('BTC-PERPETUAL');
    await expect(runtime.waitForBook('BTC-PERPETUAL', 20)).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  it('respawns a crashed worker, marks books unsynchronized and re-adds held instruments', async () => {
    const { spawn, workers } = harness();
    const runtime = create({ spawn, respawnDelayMs: 10 });
    runtime.acquire('BTC-PERPETUAL');
    await flushPorts();
    workers[0]!.events.onBook(book('BTC-PERPETUAL'));
    await flushPorts();

    workers[0]!.crash();
    expect(runtime.getBook('BTC-PERPETUAL')).toMatchObject({ state: 'unsynchronized', bids: [] });
    await new Promise((r) => setTimeout(r, 40));

    expect(workers).toHaveLength(2);
    expect(workers[1]!.feed.add).toHaveBeenCalledWith('BTC-PERPETUAL');
  });

  it('ignores books for instruments it no longer holds', async () => {
    const { spawn, workers } = harness();
    const runtime = create({ spawn, lingerMs: 0 });
    runtime.acquire('BTC-PERPETUAL').release();
    await new Promise((r) => setTimeout(r, 20));
    workers[0]!.events.onBook(book('BTC-PERPETUAL'));
    await flushPorts();
    expect(runtime.getBook('BTC-PERPETUAL')).toBeNull();
  });

  it('passes the login to the worker and replays it before re-adding books after a crash', async () => {
    const { spawn, workers } = harness();
    const runtime = new OrderBookRuntime({ spawn, respawnDelayMs: 1 });
    const auth = { kid: 'k', privateKeyPem: 'pem' };
    runtime.setAuth(auth);
    runtime.acquire('BTC-PERPETUAL');
    await flushPorts();
    expect(workers[0]?.feed.setAuth).toHaveBeenCalledWith(auth);

    workers[0]!.crash();
    await new Promise((r) => setTimeout(r, 20));
    const next = workers[1]!.feed;
    expect(next.setAuth).toHaveBeenCalledWith(auth);
    expect(next.setAuth.mock.invocationCallOrder[0]).toBeLessThan(next.add.mock.invocationCallOrder[0]!);
    await runtime.dispose();
  });
});
