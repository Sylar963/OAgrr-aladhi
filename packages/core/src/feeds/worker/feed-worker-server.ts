import type { VenueDelta } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';
import type { QuoteRecorder, QuoteRecorderEvent } from '../shared/sdk-base.js';
import type { OptionVenueAdapter, StreamHandlers } from '../shared/types.js';
import type {
  FeedWorkerCallMethod,
  FeedWorkerEvent,
  FeedWorkerPort,
  FeedWorkerRequest,
} from './protocol.js';

export type WorkerHostedAdapter = OptionVenueAdapter & {
  addQuoteRecorder?: (recorder: QuoteRecorder) => () => void;
};

export interface FeedWorkerServerOptions {
  /** Deltas are coalesced per handler and posted on this cadence; one message per tick is far
   *  cheaper to clone than one per exchange frame. The chain runtime flushes every 500ms. */
  flushIntervalMs?: number;
  diagnosticsIntervalMs?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 50;
const DEFAULT_DIAGNOSTICS_INTERVAL_MS = 2_000;

interface PendingDeltaBatch {
  venue: VenueId;
  handlerId: number;
  deltas: VenueDelta[];
}

/**
 * Runs inside the feed worker: owns the real venue adapters and answers the main thread's
 * adapter calls over `port`, batching the high-volume delta and mark streams.
 */
export function serveFeedWorker(
  port: FeedWorkerPort,
  createAdapter: (venue: VenueId) => WorkerHostedAdapter,
  options: FeedWorkerServerOptions = {},
): { dispose(): void } {
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const adapters = new Map<VenueId, WorkerHostedAdapter>();
  const handlerProxies = new Map<string, StreamHandlers>();
  const pendingDeltas = new Map<string, PendingDeltaBatch>();
  const subscriptions = new Map<number, () => Promise<void>>();
  const recorders = new Map<VenueId, () => void>();
  const pendingMarks = new Map<VenueId, QuoteRecorderEvent[]>();
  let nextSubscriptionId = 1;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const post = (event: FeedWorkerEvent): void => port.postMessage(event);

  const adapterFor = (venue: VenueId): WorkerHostedAdapter => {
    let adapter = adapters.get(venue);
    if (adapter == null) {
      adapter = createAdapter(venue);
      adapters.set(venue, adapter);
    }
    return adapter;
  };

  const postDiagnostics = (venue: VenueId, adapter: WorkerHostedAdapter): void => {
    post({
      t: 'diagnostics',
      venue,
      capabilities: adapter.capabilities,
      diagnostics: adapter.getFeedDiagnostics?.() ?? null,
    });
  };

  const flushHandler = (key: string): void => {
    const batch = pendingDeltas.get(key);
    if (batch == null) return;
    pendingDeltas.delete(key);
    post({ t: 'deltas', venue: batch.venue, handlerId: batch.handlerId, deltas: batch.deltas });
  };

  const flush = (): void => {
    flushTimer = null;
    for (const key of [...pendingDeltas.keys()]) flushHandler(key);
    for (const [venue, events] of pendingMarks) post({ t: 'marks', venue, events });
    pendingMarks.clear();
  };

  const scheduleFlush = (): void => {
    if (flushTimer == null) flushTimer = setTimeout(flush, flushIntervalMs);
  };

  // Adapters key fan-out by handler identity, so one proxy per main-thread handler is reused.
  const handlerProxyFor = (venue: VenueId, handlerId: number): StreamHandlers => {
    const key = `${venue}:${handlerId}`;
    const existing = handlerProxies.get(key);
    if (existing != null) return existing;

    const proxy: StreamHandlers = {
      onDelta: (deltas) => {
        let batch = pendingDeltas.get(key);
        if (batch == null) {
          batch = { venue, handlerId, deltas: [] };
          pendingDeltas.set(key, batch);
        }
        for (const delta of deltas) batch.deltas.push(delta);
        scheduleFlush();
      },
      onStatus: (status) => {
        // Statuses must not overtake the deltas that preceded them.
        flushHandler(key);
        post({ t: 'status', venue, handlerId, status });
      },
    };
    handlerProxies.set(key, proxy);
    return proxy;
  };

  const call = async (venue: VenueId, method: FeedWorkerCallMethod, args: unknown[]) => {
    const adapter = adapterFor(venue);
    switch (method) {
      case 'loadMarkets':
        await adapter.loadMarkets(args[0] as boolean | undefined);
        postDiagnostics(venue, adapter);
        return null;
      case 'listUnderlyings':
        return adapter.listUnderlyings();
      case 'listExpiries':
        return adapter.listExpiries(args[0] as string);
      case 'listExpiryTimestamps':
        return (await adapter.listExpiryTimestamps?.(args[0] as string)) ?? [];
      case 'fetchOptionChain':
        return adapter.fetchOptionChain(args[0] as Parameters<OptionVenueAdapter['fetchOptionChain']>[0]);
      case 'dispose':
        recorders.get(venue)?.();
        recorders.delete(venue);
        adapters.delete(venue);
        await adapter.dispose?.();
        return null;
    }
  };

  const respond = async (id: number, run: () => Promise<unknown>): Promise<void> => {
    try {
      post({ t: 'result', id, ok: true, value: await run() });
    } catch (error: unknown) {
      post({ t: 'result', id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const setRecorder = (venue: VenueId, enabled: boolean): void => {
    if (!enabled) {
      recorders.get(venue)?.();
      recorders.delete(venue);
      return;
    }
    if (recorders.has(venue)) return;
    const adapter = adapterFor(venue);
    if (adapter.addQuoteRecorder == null) return;
    recorders.set(
      venue,
      adapter.addQuoteRecorder((event) => {
        let events = pendingMarks.get(venue);
        if (events == null) {
          events = [];
          pendingMarks.set(venue, events);
        }
        events.push(event);
        scheduleFlush();
      }),
    );
  };

  port.on('message', (raw: unknown) => {
    const message = raw as FeedWorkerRequest;
    switch (message.t) {
      case 'call':
        void respond(message.id, () => call(message.venue, message.method, message.args));
        return;
      case 'subscribe':
        void respond(message.id, async () => {
          const adapter = adapterFor(message.venue);
          if (adapter.subscribe == null) return null;
          const release = await adapter.subscribe(
            message.request,
            handlerProxyFor(message.venue, message.handlerId),
          );
          const subscriptionId = nextSubscriptionId++;
          subscriptions.set(subscriptionId, release);
          return subscriptionId;
        });
        return;
      case 'unsubscribe':
        void respond(message.id, async () => {
          const release = subscriptions.get(message.subscriptionId);
          subscriptions.delete(message.subscriptionId);
          await release?.();
          return null;
        });
        return;
      case 'removeDeltaHandler': {
        const key = `${message.venue}:${message.handlerId}`;
        const proxy = handlerProxies.get(key);
        if (proxy == null) return;
        handlerProxies.delete(key);
        pendingDeltas.delete(key);
        adapters.get(message.venue)?.removeDeltaHandler?.(proxy);
        return;
      }
      case 'recorder':
        setRecorder(message.venue, message.enabled);
        return;
    }
  });

  const diagnosticsTimer = setInterval(() => {
    for (const [venue, adapter] of adapters) postDiagnostics(venue, adapter);
  }, options.diagnosticsIntervalMs ?? DEFAULT_DIAGNOSTICS_INTERVAL_MS);

  return {
    dispose() {
      clearInterval(diagnosticsTimer);
      if (flushTimer != null) clearTimeout(flushTimer);
      flushTimer = null;
      for (const unsubscribe of recorders.values()) unsubscribe();
      recorders.clear();
    },
  };
}
