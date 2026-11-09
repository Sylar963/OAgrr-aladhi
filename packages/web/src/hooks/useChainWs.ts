import { isAppVisible } from '@lib/app-visibility';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';

import type {
  EnrichedChainResponse,
  EnrichedSide,
  EnrichedStrike,
  VenueQuote,
} from '@shared/enriched';
import type { WsConnectionState, VenueFailure } from '@oggregator/protocol';
import { ChainDiffEnvelopeSchema, ServerWsMessageSchema } from '@oggregator/protocol';
import { chainKeys } from '@features/chain/queries';
import { applyStrikeDiffs } from './chain-diff';
import { MOBILE_QUERY } from '@lib/breakpoints';
import { onConnectionResume } from '@lib/connection-resume';
import { wsUrl } from '@lib/http';

interface UseChainWsOptions {
  underlying: string;
  expiry: string;
  venues: string[];
  enabled?: boolean;
}

interface UseChainWsResult {
  connectionState: WsConnectionState;
  staleMs: number | null;
  venueLagMs: Record<string, number>;
  lastSeq: number;
  failedVenues: VenueFailure[];
  venueStates: Record<string, WsConnectionState>;
}

type StatusSnapshot = UseChainWsResult;

// Servers that predate per-venue lag omit the field; a shared empty object keeps the store stable.
const NO_VENUE_LAG: Record<string, number> = {};

// The server sends nothing while no quote changes, so silence alone can't tell a quiet chain from a
// dead connection that never reported a close. After this long, a re-subscribe asks the server to
// answer, and only no answer replaces the socket.
const SILENT_SOCKET_MS = 30_000;
const SILENCE_CHECK_MS = 10_000;
const PROBE_TIMEOUT_MS = 10_000;

// Phones render every strike in the list, and the server pushes twice a second. Batching to one
// render a second halves that work; a one-second-old quote isn't noticeable on a phone-sized list.
const MOBILE_FLUSH_MS = 1_000;

const MAX_LIVE_CHAINS_PER_PAGE = 3;

// Long enough to reuse the socket across a tab switch or the brief empty expiry after a ticker change.
const IDLE_RELEASE_MS = 5_000;

const INITIAL_SNAPSHOT: StatusSnapshot = {
  connectionState: 'closed',
  staleMs: null,
  venueLagMs: NO_VENUE_LAG,
  lastSeq: 0,
  failedVenues: [],
  venueStates: {},
};

/**
 * Minimal ref-backed store consumed via useSyncExternalStore so only components
 * that read a changed slice re-render on WS updates.
 */
function createStatusStore() {
  let snap: StatusSnapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();

  return {
    get: () => snap,
    set(next: Partial<StatusSnapshot>) {
      const merged: StatusSnapshot = { ...snap, ...next };
      if (
        merged.connectionState === snap.connectionState &&
        merged.staleMs === snap.staleMs &&
        merged.venueLagMs === snap.venueLagMs &&
        merged.lastSeq === snap.lastSeq &&
        merged.failedVenues === snap.failedVenues &&
        merged.venueStates === snap.venueStates
      ) {
        return;
      }
      snap = merged;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

let subIdCounter = 0;
function nextSubId(): string {
  return `sub-${++subIdCounter}-${Date.now()}`;
}

function requestKey(underlying: string, expiry: string, venues: string[]): string {
  return `${underlying}\u0000${expiry}\u0000${[...venues].sort().join(',')}`;
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

// Structural equality on a single venue quote. Two refs that read equal here
// can be treated as the same value — letting React.memo skip the row render.
function quotesEqual(a: VenueQuote | null | undefined, b: VenueQuote | null | undefined): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return (
    a.bid === b.bid &&
    a.ask === b.ask &&
    a.mid === b.mid &&
    a.bidSize === b.bidSize &&
    a.askSize === b.askSize &&
    a.markIv === b.markIv &&
    a.bidIv === b.bidIv &&
    a.askIv === b.askIv &&
    a.delta === b.delta &&
    a.gamma === b.gamma &&
    a.theta === b.theta &&
    a.vega === b.vega &&
    a.spreadPct === b.spreadPct &&
    a.totalCost === b.totalCost &&
    a.openInterest === b.openInterest &&
    a.volume24h === b.volume24h &&
    a.openInterestUsd === b.openInterestUsd &&
    a.volume24hUsd === b.volume24hUsd &&
    a.asOfMs === b.asOfMs &&
    (a.estimatedFees == null
      ? b.estimatedFees == null
      : b.estimatedFees != null &&
        a.estimatedFees.maker === b.estimatedFees.maker &&
        a.estimatedFees.taker === b.estimatedFees.taker)
  );
}

function sidesEqual(a: EnrichedSide, b: EnrichedSide): boolean {
  if (a === b) return true;
  if (a.bestIv !== b.bestIv || a.bestVenue !== b.bestVenue) return false;
  const aKeys = Object.keys(a.venues);
  const bKeys = Object.keys(b.venues);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!quotesEqual(a.venues[k as keyof typeof a.venues], b.venues[k as keyof typeof b.venues])) {
      return false;
    }
  }
  return true;
}

function strikesEqual(a: EnrichedStrike, b: EnrichedStrike): boolean {
  return (
    a === b || (a.strike === b.strike && sidesEqual(a.call, b.call) && sidesEqual(a.put, b.put))
  );
}

// Delta path: incoming carries only the strikes that changed. Keep every
// existing entry; overlay changed ones, reusing the prior ref when the new
// strike happens to be content-equal so memo'd rows don't re-render.
function mergeStrikes(existing: EnrichedStrike[], incoming: EnrichedStrike[]): EnrichedStrike[] {
  const byStrike = new Map<number, EnrichedStrike>();

  for (const strike of existing) {
    byStrike.set(strike.strike, strike);
  }
  for (const strike of incoming) {
    const prev = byStrike.get(strike.strike);
    byStrike.set(strike.strike, prev && strikesEqual(prev, strike) ? prev : strike);
  }

  return [...byStrike.values()].sort((left, right) => left.strike - right.strike);
}

// Snapshot path: incoming defines the complete strike set for the tenor. Any
// strike not present in `incoming` must be dropped (so a resync removes
// stale entries). For strikes present in both, reuse the existing ref when
// content matches — this is what makes a resync snapshot not re-render the
// whole table.
function reconcileSnapshotStrikes(
  existing: EnrichedStrike[],
  incoming: EnrichedStrike[],
): EnrichedStrike[] {
  if (existing.length === 0) return incoming;
  const existingByStrike = new Map<number, EnrichedStrike>();
  for (const s of existing) existingByStrike.set(s.strike, s);
  return incoming.map((next) => {
    const prev = existingByStrike.get(next.strike);
    return prev && strikesEqual(prev, next) ? prev : next;
  });
}

type DeltaMsg = Extract<ReturnType<typeof ServerWsMessageSchema.parse>, { type: 'delta' }>;
type DiffMsg = Extract<ReturnType<typeof ServerWsMessageSchema.parse>, { type: 'diff' }>;

type StatusMsg = Extract<ReturnType<typeof ServerWsMessageSchema.parse>, { type: 'status' }>;

// A subscription's first diff gets the full schema, which catches a client/server version mismatch.
// Later diffs on it only get their envelope checked, because deep-validating thousands of quote
// fields twice a second is the most expensive per-frame work on a phone.
function parseServerMessage(
  json: unknown,
  verifiedDiffSubId: string | null,
): ReturnType<typeof ServerWsMessageSchema.parse> | null {
  if (verifiedDiffSubId != null) {
    const envelope = ChainDiffEnvelopeSchema.safeParse(json);
    if (envelope.success && envelope.data.subscriptionId === verifiedDiffSubId) {
      return envelope.data as DiffMsg;
    }
  }
  const parsed = ServerWsMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

const CONNECTION_STATE_ORDER: WsConnectionState[] = ['live', 'reconnecting', 'stale', 'error'];

function mapServerStateToWsConnectionState(state: StatusMsg['state']): WsConnectionState {
  switch (state) {
    case 'connected':
      return 'live';
    case 'reconnecting':
    case 'polling':
      return 'reconnecting';
    case 'degraded':
      return 'stale';
    case 'down':
      return 'error';
    default:
      return 'live';
  }
}

function worstConnectionState(states: Iterable<WsConnectionState>): WsConnectionState {
  let worst: WsConnectionState = 'live';
  for (const s of states) {
    if (CONNECTION_STATE_ORDER.indexOf(s) > CONNECTION_STATE_ORDER.indexOf(worst)) worst = s;
  }
  return worst;
}

type PendingPatch =
  | { kind: 'strikes'; patch: DeltaMsg['patch'] }
  | { kind: 'diff'; patch: DiffMsg['patch'] };

type PendingDelta = PendingPatch & {
  key: ReturnType<typeof chainKeys.chain>;
  seq: number;
  staleMs: number;
  venueLagMs: Record<string, number>;
};

interface ChainFeedParams {
  underlying: string;
  expiry: string;
  venues: string[];
  requestKey: string;
}

type StatusStore = ReturnType<typeof createStatusStore>;

// One socket per request. Validates incoming messages with Zod, gates on subscriptionId, and pushes
// snapshots into the TanStack Query cache. Delta applications are coalesced per animation frame so
// a burst of patches results in a single cache write + re-render.
class ChainFeedConnection {
  readonly status: StatusStore = createStatusStore();
  subscribers = 0;
  idleTimer: ReturnType<typeof setTimeout> | null = null;

  private ws: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSubId: string | null = null;
  private lastSubscribeRequestKey: string | null = null;
  private lastMessageAt = 0;
  private probeSentAt = 0;
  private verifiedDiffSubId: string | null = null;
  private pending: PendingDelta[] = [];
  private raf: number | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  // Last received snapshot across all cache keys. Used as a reconciliation
  // baseline on tenor change so strikes whose content happens to match
  // (deep OTM, all-null venues) keep their ref instead of getting a fresh one.
  private lastSnapshot: EnrichedChainResponse | null = null;
  private readonly stopResume: () => void;
  private readonly silenceTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly qc: QueryClient,
    public params: ChainFeedParams,
  ) {
    this.connect();
    this.stopResume = onConnectionResume(this.replaceSocket);
    this.silenceTimer = setInterval(this.checkSilence, SILENCE_CHECK_MS);
  }

  // Keeps the socket when the request changes. Tearing down forced a closed → connecting → live
  // cycle on every tenor change, which made the FreshnessLabel ms display flicker visibly. A socket
  // still CONNECTING picks up the new params in its onopen handler.
  retarget(params: ChainFeedParams): void {
    this.params = params;
    this.connect();
    if (this.ws?.readyState === WebSocket.OPEN) this.sendSubscribe(this.ws);
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.stopResume();
    clearInterval(this.silenceTimer);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.raf != null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.raf);
      } else {
        clearTimeout(this.raf as unknown as ReturnType<typeof setTimeout>);
      }
      this.raf = null;
    }
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending = [];
    this.activeSubId = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, 'unmount');
      this.ws = null;
    }
    this.status.set({ connectionState: 'closed' });
  }

  private readonly flushDeltas = () => {
    this.raf = null;
    this.flushTimer = null;
    const queue = this.pending;
    if (queue.length === 0) return;
    this.pending = [];

    // Group by cache key so bursts against the same chain coalesce to one write.
    const byKey = new Map<string, PendingDelta[]>();
    for (const p of queue) {
      const k = JSON.stringify(p.key);
      const list = byKey.get(k);
      if (list) list.push(p);
      else byKey.set(k, [p]);
    }

    for (const patches of byKey.values()) {
      const last = patches[patches.length - 1]!;
      this.qc.setQueryData(last.key, (current: EnrichedChainResponse | undefined) => {
        if (current == null) return current;
        let strikes = current.strikes;
        for (const p of patches) {
          strikes =
            p.kind === 'diff'
              ? applyStrikeDiffs(strikes, p.patch.strikes)
              : mergeStrikes(strikes, p.patch.strikes);
        }
        return {
          ...current,
          stats: last.patch.stats,
          strikes,
          gex: last.patch.gex ?? current.gex,
          gexProfile: last.patch.gexProfile ?? current.gexProfile,
        };
      });
    }

    const last = queue[queue.length - 1]!;
    this.status.set({
      connectionState: 'live',
      staleMs: last.staleMs,
      venueLagMs: last.venueLagMs,
      lastSeq: last.seq,
    });
  };

  private scheduleFlush(): void {
    if (this.raf != null || this.flushTimer != null) return;
    if (window.matchMedia?.(MOBILE_QUERY).matches) {
      this.flushTimer = setTimeout(this.flushDeltas, MOBILE_FLUSH_MS);
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      this.raf = requestAnimationFrame(this.flushDeltas);
    } else {
      this.raf = setTimeout(this.flushDeltas, 16) as unknown as number;
    }
  }

  private sendSubscribe(ws: WebSocket): void {
    const { underlying: u, expiry: e, venues: v, requestKey: key } = this.params;
    if (this.lastSubscribeRequestKey === key) return;

    const subId = nextSubId();
    this.activeSubId = subId;

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        subscriptionId: subId,
        request: { underlying: u, expiry: e, venues: v },
        patchFormat: 'diff',
      }),
    );
    this.lastSubscribeRequestKey = key;
  }

  private readonly handleMessage = (event: MessageEvent) => {
    this.lastMessageAt = Date.now();
    let json: unknown;
    try {
      json = JSON.parse(event.data as string);
    } catch {
      return;
    }

    const msg = parseServerMessage(json, this.verifiedDiffSubId);
    if (msg == null) return;
    if (msg.type === 'diff') this.verifiedDiffSubId = msg.subscriptionId;

    if ('subscriptionId' in msg && msg.subscriptionId !== this.activeSubId) return;

    switch (msg.type) {
      case 'snapshot': {
        // The server can accept the socket and close it straight away (not ready, slow client),
        // so only a delivered snapshot proves the connection and resets the backoff.
        this.attempt = 0;
        // Anything still batched is older than this snapshot and would overwrite it.
        this.pending = [];
        const serverKey = chainKeys.chain(
          msg.request.underlying,
          msg.request.expiry,
          msg.request.venues,
        );
        const requestedKey = chainKeys.chain(
          this.params.underlying,
          this.params.expiry,
          this.params.venues,
        );
        const writeSnapshot = (key: ReturnType<typeof chainKeys.chain>) => {
          this.qc.setQueryData(key, (current: EnrichedChainResponse | undefined) => {
            // Reconcile against the cache for this exact key first (resync
            // within same tenor); fall back to the most recent snapshot from
            // any tenor so cross-tenor switches still benefit from content-
            // equal strikes keeping their refs.
            const baseline = current ?? this.lastSnapshot ?? undefined;
            if (baseline == null) return msg.data;
            return {
              ...msg.data,
              strikes: reconcileSnapshotStrikes(baseline.strikes, msg.data.strikes),
            };
          });
        };

        writeSnapshot(serverKey);
        if (JSON.stringify(serverKey) !== JSON.stringify(requestedKey)) {
          writeSnapshot(requestedKey);
        }
        this.lastSnapshot =
          this.qc.getQueryData<EnrichedChainResponse>(requestedKey) ??
          this.qc.getQueryData<EnrichedChainResponse>(serverKey) ??
          msg.data;
        this.status.set({
          connectionState: 'live',
          staleMs: msg.meta.staleMs,
          venueLagMs: msg.meta.venueLagMs ?? NO_VENUE_LAG,
          lastSeq: msg.seq,
        });
        break;
      }

      case 'delta':
      case 'diff': {
        const serverKey = chainKeys.chain(
          msg.request.underlying,
          msg.request.expiry,
          msg.request.venues,
        );
        const requestedKey = chainKeys.chain(
          this.params.underlying,
          this.params.expiry,
          this.params.venues,
        );
        const pending: PendingPatch =
          msg.type === 'diff'
            ? { kind: 'diff', patch: msg.patch }
            : { kind: 'strikes', patch: msg.patch };
        const meta = {
          seq: msg.seq,
          staleMs: msg.meta.staleMs,
          venueLagMs: msg.meta.venueLagMs ?? NO_VENUE_LAG,
        };
        this.pending.push({ ...pending, ...meta, key: serverKey });
        if (JSON.stringify(serverKey) !== JSON.stringify(requestedKey)) {
          this.pending.push({ ...pending, ...meta, key: requestedKey });
        }
        this.scheduleFlush();
        break;
      }

      case 'subscribed':
        this.status.set({ connectionState: 'live', failedVenues: msg.failedVenues ?? [] });
        break;

      case 'status': {
        const mapped = mapServerStateToWsConnectionState(msg.state);
        const prev = this.status.get();
        // Skip the spread + store.set when nothing changed — preserves
        // reference equality so useSyncExternalStore doesn't re-render.
        if (prev.venueStates[msg.venue] === mapped) break;
        const venueStates: Record<string, WsConnectionState> = {
          ...prev.venueStates,
          [msg.venue]: mapped,
        };
        this.status.set({
          connectionState: worstConnectionState(Object.values(venueStates)),
          venueStates,
        });
        break;
      }

      case 'error':
        if (!msg.retryable) this.status.set({ connectionState: 'error' });
        break;
    }
  };

  private connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const envWsBase = import.meta.env.VITE_WS_URL;
    const chainWsUrl = envWsBase ? `${envWsBase.replace(/\/$/, '')}/ws/chain` : wsUrl('/ws/chain');

    const ws = new WebSocket(chainWsUrl);
    this.ws = ws;
    this.lastSubscribeRequestKey = null;
    this.lastMessageAt = Date.now();
    this.status.set({ connectionState: 'connecting' });

    ws.onopen = () => {
      this.sendSubscribe(ws);
    };

    ws.onmessage = this.handleMessage;

    ws.onclose = () => {
      this.ws = null;
      this.status.set({ connectionState: 'reconnecting' });
      this.scheduleReconnect();
    };

    // onerror usually precedes onclose for transient transport failures.
    // Keep reconnect logic centralized in onclose so retries remain unbounded.
    ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = backoffMs(this.attempt);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private readonly replaceSocket = () => {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.attempt = 0;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connect();
  };

  private readonly checkSilence = () => {
    const ws = this.ws;
    if (!isAppVisible() || !ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - this.lastMessageAt < SILENT_SOCKET_MS) return;
    if (this.probeSentAt <= this.lastMessageAt) {
      this.probeSentAt = now;
      this.lastSubscribeRequestKey = null;
      this.sendSubscribe(ws);
    } else if (now - this.probeSentAt >= PROBE_TIMEOUT_MS) {
      this.replaceSocket();
    }
  };
}

interface ChainFeedSubscriber {
  params: ChainFeedParams;
  store: StatusStore;
  connection: ChainFeedConnection | null;
  stopListening: (() => void) | null;
}

// Each socket carries one subscription, and every distinct request costs the server an engine plus
// venue subscriptions, so widgets asking for the same chain share one connection.
class ChainFeedHub {
  private connections: ChainFeedConnection[] = [];
  private waiting: ChainFeedSubscriber[] = [];

  constructor(private readonly qc: QueryClient) {}

  acquire(params: ChainFeedParams, store: StatusStore): () => void {
    const subscriber: ChainFeedSubscriber = {
      params,
      store,
      connection: null,
      stopListening: null,
    };
    this.attach(subscriber);
    return () => this.release(subscriber);
  }

  private attach(subscriber: ChainFeedSubscriber): void {
    const connection = this.connectionFor(subscriber.params);
    if (connection == null) {
      this.waiting.push(subscriber);
      subscriber.store.set({ connectionState: 'closed' });
      return;
    }
    if (connection.idleTimer) {
      clearTimeout(connection.idleTimer);
      connection.idleTimer = null;
    }
    connection.subscribers += 1;
    subscriber.connection = connection;
    const sync = () => subscriber.store.set(connection.status.get());
    sync();
    subscriber.stopListening = connection.status.subscribe(sync);
  }

  private connectionFor(params: ChainFeedParams): ChainFeedConnection | null {
    const existing = this.connections.find((c) => c.params.requestKey === params.requestKey);
    if (existing) return existing;
    const idle = this.connections.find((c) => c.subscribers === 0);
    if (idle) {
      idle.retarget(params);
      return idle;
    }
    if (this.connections.length >= MAX_LIVE_CHAINS_PER_PAGE) return null;
    const created = new ChainFeedConnection(this.qc, params);
    this.connections.push(created);
    return created;
  }

  private release(subscriber: ChainFeedSubscriber): void {
    this.waiting = this.waiting.filter((w) => w !== subscriber);
    const connection = subscriber.connection;
    if (connection == null) return;
    subscriber.stopListening?.();
    connection.subscribers -= 1;
    if (connection.subscribers > 0) return;

    const next = this.waiting.shift();
    if (next) {
      this.attach(next);
      return;
    }
    connection.idleTimer = setTimeout(() => {
      this.connections = this.connections.filter((c) => c !== connection);
      connection.dispose();
    }, IDLE_RELEASE_MS);
  }
}

const hubs = new WeakMap<QueryClient, ChainFeedHub>();

function hubFor(qc: QueryClient): ChainFeedHub {
  let hub = hubs.get(qc);
  if (hub == null) {
    hub = new ChainFeedHub(qc);
    hubs.set(qc, hub);
  }
  return hub;
}

/** Subscribes to real-time chain updates, sharing one socket per distinct request across the page. */
export function useChainWs({
  underlying,
  expiry,
  venues,
  enabled = true,
}: UseChainWsOptions): UseChainWsResult {
  const qc = useQueryClient();
  const storeRef = useRef<StatusStore | null>(null);
  storeRef.current ??= createStatusStore();
  const store = storeRef.current;

  const key = enabled && underlying && expiry ? requestKey(underlying, expiry, venues) : null;
  const paramsRef = useRef<ChainFeedParams>({ underlying, expiry, venues, requestKey: key ?? '' });
  paramsRef.current = { underlying, expiry, venues, requestKey: key ?? '' };

  useEffect(() => {
    if (key == null) {
      store.set({ connectionState: 'closed' });
      return;
    }
    return hubFor(qc).acquire(paramsRef.current, store);
  }, [qc, key, store]);

  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
