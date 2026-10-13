import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChainRequest, VenueDelta, VenueOptionChain, VenueStatus } from '../../core/types.js';
import { VenueSubscriptionCoordinator } from '../../core/subscription-coordinator.js';
import type { QuoteRecorder } from '../shared/sdk-base.js';
import type { StreamHandlers, VenueCapabilities } from '../shared/types.js';
import { FeedWorkerHost, type FeedWorkerHandle } from './feed-worker-client.js';
import { serveFeedWorker, type WorkerHostedAdapter } from './feed-worker-server.js';

class FakeVenueAdapter implements WorkerHostedAdapter {
  readonly venue = 'deribit' as const;
  readonly capabilities: VenueCapabilities = { optionChain: true, greeks: true, websocket: true };
  readonly handlers = new Set<StreamHandlers>();
  readonly subscribed: ChainRequest[] = [];
  readonly recorders = new Set<QuoteRecorder>();
  loadCalls = 0;

  async loadMarkets(): Promise<void> {
    this.loadCalls += 1;
  }
  async listUnderlyings(): Promise<string[]> {
    return ['BTC'];
  }
  async listExpiries(): Promise<string[]> {
    return ['2026-03-27'];
  }
  async fetchOptionChain(request: ChainRequest): Promise<VenueOptionChain> {
    if (request.expiry === 'boom') throw new Error('chain unavailable');
    return { venue: 'deribit', underlying: request.underlying, expiry: request.expiry, asOf: 1, contracts: {} };
  }
  async subscribe(request: ChainRequest, handlers: StreamHandlers): Promise<() => Promise<void>> {
    if (request.expiry === '2099-01-01') {
      handlers.onStatus({ venue: 'deribit', state: 'down', ts: 1, message: 'no instruments for request' });
      return async () => {};
    }
    this.subscribed.push(request);
    this.handlers.add(handlers);
    return async () => {
      this.handlers.delete(handlers);
    };
  }
  getFeedDiagnostics() {
    return { connected: true, lastActivityAt: 42, reconnectAttempts: 0, rateLimitUntil: 0 };
  }
  addQuoteRecorder(recorder: QuoteRecorder): () => void {
    this.recorders.add(recorder);
    return () => this.recorders.delete(recorder);
  }

  emitDeltas(deltas: VenueDelta[]): void {
    for (const handlers of this.handlers) handlers.onDelta(deltas);
  }
  emitStatus(status: VenueStatus): void {
    for (const handlers of this.handlers) handlers.onStatus(status);
  }
}

function delta(symbol: string, ts: number): VenueDelta {
  return { venue: 'deribit', symbol, ts } as VenueDelta;
}

const BTC_CALL = 'BTC/USD:BTC-260327-70000-C';
const REQUEST: ChainRequest = { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] };

interface Harness {
  host: FeedWorkerHost;
  workers: FakeVenueAdapter[];
  crash(): void;
}

const openPorts: MessagePort[] = [];

function startHarness(): Harness {
  const workers: FakeVenueAdapter[] = [];
  let exit: ((code: number) => void) | null = null;
  let stopServer: (() => void) | null = null;

  const spawn = (): FeedWorkerHandle => {
    const { port1, port2 } = new MessageChannel();
    openPorts.push(port1, port2);
    const adapter = new FakeVenueAdapter();
    workers.push(adapter);
    stopServer = serveFeedWorker(port2, () => adapter, { flushIntervalMs: 5, diagnosticsIntervalMs: 10 }).dispose;
    return {
      port: port1,
      terminate: async () => {
        stopServer?.();
        port1.close();
        port2.close();
      },
      onExit: (listener) => {
        exit = listener;
      },
    };
  };

  return {
    host: new FeedWorkerHost(spawn),
    workers,
    crash: () => {
      stopServer?.();
      exit?.(1);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const port of openPorts.splice(0)) port.close();
});

describe('FeedWorkerHost', () => {
  it('proxies adapter calls and surfaces worker-side errors', async () => {
    const { host } = startHarness();
    const adapter = host.adapter('deribit');

    await adapter.loadMarkets();
    expect(await adapter.listUnderlyings()).toEqual(['BTC']);
    expect(await adapter.listExpiries('BTC')).toEqual(['2026-03-27']);
    expect((await adapter.fetchOptionChain(REQUEST)).expiry).toBe('2026-03-27');
    await expect(adapter.fetchOptionChain({ ...REQUEST, expiry: 'boom' })).rejects.toThrow(
      'chain unavailable',
    );
    await vi.waitFor(() => expect(adapter.getFeedDiagnostics()?.lastActivityAt).toBe(42));

    await host.shutdown();
  });

  it('batches worker deltas and keeps one worker-side handler per main-thread handler', async () => {
    const { host, workers } = startHarness();
    const adapter = host.adapter('deribit');
    const onDelta = vi.fn<(deltas: VenueDelta[]) => void>();
    const handlers: StreamHandlers = { onDelta, onStatus: () => {} };

    const releaseBtc = await adapter.subscribe(REQUEST, handlers);
    const releaseEth = await adapter.subscribe({ ...REQUEST, underlying: 'ETH' }, handlers);
    expect(workers[0]!.handlers.size).toBe(1);

    workers[0]!.emitDeltas([delta(BTC_CALL, 1)]);
    workers[0]!.emitDeltas([delta(BTC_CALL, 2)]);
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalled());

    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta.mock.calls[0]![0].map((d) => d.ts)).toEqual([1, 2]);

    await releaseBtc();
    await releaseEth();
    expect(workers[0]!.handlers.size).toBe(0);
    await host.shutdown();
  });

  it('delivers a status after the deltas that preceded it', async () => {
    const { host, workers } = startHarness();
    const order: string[] = [];
    await host.adapter('deribit').subscribe(REQUEST, {
      onDelta: () => order.push('delta'),
      onStatus: (status) => order.push(status.state),
    });

    workers[0]!.emitDeltas([delta(BTC_CALL, 1)]);
    workers[0]!.emitStatus({ venue: 'deribit', state: 'reconnecting', ts: 2 });
    await vi.waitFor(() => expect(order).toEqual(['delta', 'reconnecting']));

    await host.shutdown();
  });

  it('routes request-scoped statuses through the coordinator to the subscribing request', async () => {
    const { host } = startHarness();
    const proxy = host.adapter('deribit');
    const coordinator = new VenueSubscriptionCoordinator({ getAdapter: () => proxy });
    const supported = vi.fn<(status: VenueStatus) => void>();
    const unsupported = vi.fn<(status: VenueStatus) => void>();

    await coordinator.acquire('deribit', REQUEST, { onStatus: supported });
    await coordinator.acquire('deribit', { ...REQUEST, expiry: '2099-01-01' }, { onStatus: unsupported });

    expect(unsupported).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'no instruments for request' }),
    );
    expect(supported).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'no instruments for request' }),
    );
    await host.shutdown();
  });

  it('forwards quote recorder events in batches', async () => {
    const { host, workers } = startHarness();
    const recorded: number[] = [];
    host.adapter('deribit').addQuoteRecorder((event) => recorded.push(event.ts));
    await vi.waitFor(() => expect(workers[0]!.recorders.size).toBe(1));

    for (const recorder of workers[0]!.recorders) {
      recorder({ venue: 'deribit', exchangeSymbol: 'BTC-X', ts: 1, markPrice: 10 });
      recorder({ venue: 'deribit', exchangeSymbol: 'BTC-X', ts: 2, markPrice: 11 });
    }
    await vi.waitFor(() => expect(recorded).toEqual([1, 2]));

    await host.shutdown();
  });

  it('respawns a crashed worker and replays markets, recorders and subscriptions', async () => {
    const { host, workers, crash } = startHarness();
    const adapter = host.adapter('deribit');
    const statuses: VenueStatus[] = [];
    const onDelta = vi.fn<(deltas: VenueDelta[]) => void>();
    await adapter.loadMarkets();
    adapter.addQuoteRecorder(() => {});
    await adapter.subscribe(REQUEST, { onDelta, onStatus: (status) => statuses.push(status) });

    crash();
    expect(statuses.at(-1)).toMatchObject({ state: 'reconnecting', message: 'feed worker restarting' });

    await vi.waitFor(() => expect(workers[1]?.subscribed).toEqual([REQUEST]), { timeout: 3_000 });
    expect(workers[1]!.loadCalls).toBe(1);
    expect(workers[1]!.recorders.size).toBe(1);

    workers[1]!.emitDeltas([delta(BTC_CALL, 7)]);
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalled());
    await host.shutdown();
  });
});
