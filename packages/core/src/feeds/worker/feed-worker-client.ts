import { Worker } from 'node:worker_threads';
import type { ChainRequest, VenueDelta, VenueOptionChain, VenueStatus } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import type { QuoteRecorder, QuoteRecorderEvent } from '../shared/sdk-base.js';
import type { OptionVenueAdapter, StreamHandlers, VenueCapabilities } from '../shared/types.js';
import type {
  FeedDiagnostics,
  FeedWorkerCallMethod,
  FeedWorkerEvent,
  FeedWorkerPort,
  FeedWorkerRequest,
} from './protocol.js';

const log = feedLogger('feed-worker');

const RESPAWN_DELAY_MS = 1_000;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface FeedWorkerHandle {
  port: FeedWorkerPort;
  terminate(): Promise<unknown>;
  onExit(listener: (code: number) => void): void;
}

function spawnFeedWorkerThread(): FeedWorkerHandle {
  const worker = new Worker(new URL('./feed-worker.js', import.meta.url));
  // An 'error' event with no listener would be rethrown on the main thread.
  worker.on('error', (error) => log.error({ err: String(error) }, 'feed worker crashed'));
  return {
    port: worker,
    terminate: () => worker.terminate(),
    onExit: (listener) => worker.on('exit', listener),
  };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Runs the venue adapters on a worker thread so exchange-frame parsing and normalization stay
 * off the event loop that serves HTTP, chain fan-out and portfolio work. `adapter(venue)` returns
 * a drop-in {@link OptionVenueAdapter}; a crashed worker is respawned and its state replayed.
 */
export class FeedWorkerHost {
  private handle: FeedWorkerHandle | null = null;
  private readonly pending = new Map<number, PendingCall>();
  private readonly proxies = new Map<VenueId, WorkerVenueAdapter>();
  private nextRequestId = 1;
  private disposed = false;

  constructor(private readonly spawn: () => FeedWorkerHandle = spawnFeedWorkerThread) {
    this.start();
  }

  adapter(venue: VenueId): WorkerVenueAdapter {
    let proxy = this.proxies.get(venue);
    if (proxy == null) {
      proxy = new WorkerVenueAdapter(venue, this);
      this.proxies.set(venue, proxy);
    }
    return proxy;
  }

  request<T>(message: DistributiveOmit<FeedWorkerRequest, 'id'>): Promise<T> {
    const handle = this.handle;
    if (handle == null) return Promise.reject(new Error('feed worker is not running'));
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      handle.port.postMessage({ ...message, id });
    });
  }

  send(message: FeedWorkerRequest): void {
    this.handle?.port.postMessage(message);
  }

  async shutdown(): Promise<void> {
    this.disposed = true;
    const handle = this.handle;
    this.handle = null;
    this.rejectPending('feed worker shut down');
    await handle?.terminate();
  }

  private start(): void {
    const handle = this.spawn();
    this.handle = handle;
    handle.port.on('message', (raw) => this.onEvent(raw as FeedWorkerEvent));
    handle.onExit((code) => this.onExit(handle, code));
  }

  private onEvent(event: FeedWorkerEvent): void {
    switch (event.t) {
      case 'result': {
        const call = this.pending.get(event.id);
        if (call == null) return;
        this.pending.delete(event.id);
        if (event.ok) call.resolve(event.value);
        else call.reject(new Error(event.error));
        return;
      }
      case 'deltas':
        this.proxies.get(event.venue)?.dispatchDeltas(event.handlerId, event.deltas);
        return;
      case 'status':
        this.proxies.get(event.venue)?.dispatchStatus(event.handlerId, event.status);
        return;
      case 'marks':
        this.proxies.get(event.venue)?.dispatchMarks(event.events);
        return;
      case 'diagnostics':
        this.proxies.get(event.venue)?.updateDiagnostics(event.capabilities, event.diagnostics);
        return;
    }
  }

  private onExit(handle: FeedWorkerHandle, code: number): void {
    if (this.disposed || this.handle !== handle) return;
    log.error({ code }, 'feed worker exited, respawning');
    this.handle = null;
    this.rejectPending(`feed worker exited with code ${code}`);
    for (const proxy of this.proxies.values()) proxy.handleWorkerLost();

    setTimeout(() => {
      if (this.disposed) return;
      this.start();
      for (const proxy of this.proxies.values()) {
        void proxy.restore().catch((error: unknown) => {
          log.error({ venue: proxy.venue, err: String(error) }, 'feed worker venue restore failed');
        });
      }
    }, RESPAWN_DELAY_MS);
  }

  private rejectPending(reason: string): void {
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const call of calls) call.reject(new Error(reason));
  }
}

interface ProxySubscription {
  request: ChainRequest;
  handlerId: number;
  workerSubscriptionId: number | null;
}

const DEFAULT_CAPABILITIES: VenueCapabilities = { optionChain: true, greeks: true, websocket: true };

/** Main-thread stand-in for an adapter that lives on the feed worker. */
export class WorkerVenueAdapter implements OptionVenueAdapter {
  capabilities: VenueCapabilities = DEFAULT_CAPABILITIES;
  private diagnostics: FeedDiagnostics | null = null;
  private marketsLoaded = false;
  private readonly handlerIds = new Map<StreamHandlers, number>();
  private readonly handlersById = new Map<number, StreamHandlers>();
  private readonly handlerSubscriptionCounts = new Map<number, number>();
  private readonly subscriptions = new Set<ProxySubscription>();
  private readonly recorders = new Set<QuoteRecorder>();
  private nextHandlerId = 1;

  constructor(
    readonly venue: VenueId,
    private readonly host: FeedWorkerHost,
  ) {}

  async loadMarkets(force?: boolean): Promise<void> {
    await this.call('loadMarkets', [force]);
    this.marketsLoaded = true;
  }

  listUnderlyings(): Promise<string[]> {
    return this.call('listUnderlyings', []);
  }

  listExpiries(underlying: string): Promise<string[]> {
    return this.call('listExpiries', [underlying]);
  }

  listExpiryTimestamps(
    underlying: string,
  ): Promise<Array<{ expiry: string; expiryTs: number | null }>> {
    return this.call('listExpiryTimestamps', [underlying]);
  }

  fetchOptionChain(request: ChainRequest): Promise<VenueOptionChain> {
    return this.call('fetchOptionChain', [request]);
  }

  async subscribe(request: ChainRequest, handlers: StreamHandlers): Promise<() => Promise<void>> {
    const handlerId = this.retainHandler(handlers);
    const subscription: ProxySubscription = { request, handlerId, workerSubscriptionId: null };
    try {
      subscription.workerSubscriptionId = await this.host.request<number | null>({
        t: 'subscribe',
        venue: this.venue,
        handlerId,
        request,
      });
    } catch (error: unknown) {
      if (this.releaseHandler(handlerId)) this.forgetWorkerHandler(handlerId);
      throw error;
    }
    this.subscriptions.add(subscription);

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      this.subscriptions.delete(subscription);
      const handlerRetired = this.releaseHandler(handlerId);
      const workerSubscriptionId = subscription.workerSubscriptionId;
      if (workerSubscriptionId != null) {
        await this.host.request({ t: 'unsubscribe', subscriptionId: workerSubscriptionId });
      }
      if (handlerRetired) this.forgetWorkerHandler(handlerId);
    };
  }

  removeDeltaHandler(handlers: StreamHandlers): void {
    const handlerId = this.handlerIds.get(handlers);
    if (handlerId == null) return;
    this.handlerIds.delete(handlers);
    this.handlersById.delete(handlerId);
    this.handlerSubscriptionCounts.delete(handlerId);
    this.forgetWorkerHandler(handlerId);
  }

  async dispose(): Promise<void> {
    this.subscriptions.clear();
    this.recorders.clear();
    await this.call('dispose', []).catch(() => {});
  }

  getFeedDiagnostics(): FeedDiagnostics | null {
    return this.diagnostics;
  }

  addQuoteRecorder(recorder: QuoteRecorder): () => void {
    this.recorders.add(recorder);
    if (this.recorders.size === 1) {
      this.host.send({ t: 'recorder', venue: this.venue, enabled: true });
    }
    return () => {
      if (!this.recorders.delete(recorder)) return;
      if (this.recorders.size === 0) {
        this.host.send({ t: 'recorder', venue: this.venue, enabled: false });
      }
    };
  }

  dispatchDeltas(handlerId: number, deltas: VenueDelta[]): void {
    this.handlersById.get(handlerId)?.onDelta(deltas);
  }

  dispatchStatus(handlerId: number, status: VenueStatus): void {
    this.handlersById.get(handlerId)?.onStatus(status);
  }

  dispatchMarks(events: QuoteRecorderEvent[]): void {
    for (const recorder of this.recorders) {
      for (const event of events) {
        try {
          recorder(event);
        } catch (error: unknown) {
          log.warn({ venue: this.venue, err: String(error) }, 'quote recorder threw');
        }
      }
    }
  }

  updateDiagnostics(capabilities: VenueCapabilities, diagnostics: FeedDiagnostics | null): void {
    this.capabilities = capabilities;
    this.diagnostics = diagnostics;
  }

  handleWorkerLost(): void {
    this.diagnostics = null;
    for (const subscription of this.subscriptions) subscription.workerSubscriptionId = null;
    const status: VenueStatus = {
      venue: this.venue,
      state: 'reconnecting',
      ts: Date.now(),
      message: 'feed worker restarting',
    };
    for (const handlers of this.handlersById.values()) handlers.onStatus(status);
  }

  /** Rebuild this venue's worker-side state after a respawn. */
  async restore(): Promise<void> {
    if (!this.marketsLoaded) return;
    await this.call('loadMarkets', [false]);
    if (this.recorders.size > 0) {
      this.host.send({ t: 'recorder', venue: this.venue, enabled: true });
    }
    for (const subscription of this.subscriptions) {
      subscription.workerSubscriptionId = await this.host.request<number | null>({
        t: 'subscribe',
        venue: this.venue,
        handlerId: subscription.handlerId,
        request: subscription.request,
      });
    }
  }

  private call<T>(method: FeedWorkerCallMethod, args: unknown[]): Promise<T> {
    return this.host.request<T>({ t: 'call', venue: this.venue, method, args });
  }

  // The worker mirrors handler identity by id, so the same main-thread object keeps one id
  // for as long as any subscription holds it.
  private retainHandler(handlers: StreamHandlers): number {
    let handlerId = this.handlerIds.get(handlers);
    if (handlerId == null) {
      handlerId = this.nextHandlerId++;
      this.handlerIds.set(handlers, handlerId);
      this.handlersById.set(handlerId, handlers);
    }
    this.handlerSubscriptionCounts.set(
      handlerId,
      (this.handlerSubscriptionCounts.get(handlerId) ?? 0) + 1,
    );
    return handlerId;
  }

  // True once no subscription holds the handler, which retires its id.
  private releaseHandler(handlerId: number): boolean {
    const remaining = (this.handlerSubscriptionCounts.get(handlerId) ?? 1) - 1;
    if (remaining > 0) {
      this.handlerSubscriptionCounts.set(handlerId, remaining);
      return false;
    }
    this.handlerSubscriptionCounts.delete(handlerId);
    const handlers = this.handlersById.get(handlerId);
    this.handlersById.delete(handlerId);
    if (handlers != null) this.handlerIds.delete(handlers);
    return true;
  }

  private forgetWorkerHandler(handlerId: number): void {
    this.host.send({ t: 'removeDeltaHandler', venue: this.venue, handlerId });
  }
}
