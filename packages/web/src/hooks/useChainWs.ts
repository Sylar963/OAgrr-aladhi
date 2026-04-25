import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { EnrichedChainResponse, EnrichedStrike } from '@shared/enriched';
import type { WsConnectionState, VenueFailure } from '@oggregator/protocol';
import { ServerWsMessageSchema } from '@oggregator/protocol';
import { chainKeys } from '@features/chain/queries';

interface UseChainWsOptions {
  underlying: string;
  expiry: string;
  venues: string[];
  enabled?: boolean;
}

interface UseChainWsResult {
  connectionState: WsConnectionState;
  staleMs: number | null;
  lastSeq: number;
  failedVenues: VenueFailure[];
}

type StatusSnapshot = UseChainWsResult;

const INITIAL_SNAPSHOT: StatusSnapshot = {
  connectionState: 'closed',
  staleMs: null,
  lastSeq: 0,
  failedVenues: [],
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
        merged.lastSeq === snap.lastSeq &&
        merged.failedVenues === snap.failedVenues
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

const MAX_RETRIES = 5;

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

function mergeStrikes(existing: EnrichedStrike[], incoming: EnrichedStrike[]): EnrichedStrike[] {
  const byStrike = new Map<number, EnrichedStrike>();

  for (const strike of existing) {
    byStrike.set(strike.strike, strike);
  }
  for (const strike of incoming) {
    byStrike.set(strike.strike, strike);
  }

  return [...byStrike.values()].sort((left, right) => left.strike - right.strike);
}

type DeltaMsg = Extract<
  ReturnType<typeof ServerWsMessageSchema.parse>,
  { type: 'delta' }
>;

interface PendingDelta {
  key: ReturnType<typeof chainKeys.chain>;
  patch: DeltaMsg['patch'];
  seq: number;
  staleMs: number;
}

/**
 * Subscribes to real-time chain updates via server WebSocket.
 * Validates incoming messages with Zod, gates on subscriptionId,
 * and pushes snapshots into TanStack Query cache. Delta applications
 * are coalesced per animation frame so a burst of patches results in
 * a single cache write + re-render.
 */
export function useChainWs({
  underlying,
  expiry,
  venues,
  enabled = true,
}: UseChainWsOptions): UseChainWsResult {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSubIdRef = useRef<string | null>(null);

  const storeRef = useRef<ReturnType<typeof createStatusStore> | null>(null);
  storeRef.current ??= createStatusStore();
  const store = storeRef.current;

  const pendingRef = useRef<PendingDelta[]>([]);
  const rafRef = useRef<number | null>(null);

  const paramsRef = useRef({ underlying, expiry, venues });
  paramsRef.current = { underlying, expiry, venues };

  const flushDeltas = useCallback(() => {
    rafRef.current = null;
    const queue = pendingRef.current;
    if (queue.length === 0) return;
    pendingRef.current = [];

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
      qc.setQueryData(last.key, (current: EnrichedChainResponse | undefined) => {
        if (current == null) return current;
        let strikes = current.strikes;
        for (const p of patches) {
          strikes = mergeStrikes(strikes, p.patch.strikes);
        }
        return {
          ...current,
          stats: last.patch.stats,
          strikes,
          gex: last.patch.gex,
        };
      });
    }

    const last = queue[queue.length - 1]!;
    store.set({ connectionState: 'live', staleMs: last.staleMs, lastSeq: last.seq });
  }, [qc, store]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    if (typeof requestAnimationFrame === 'function') {
      rafRef.current = requestAnimationFrame(flushDeltas);
    } else {
      rafRef.current = setTimeout(flushDeltas, 16) as unknown as number;
    }
  }, [flushDeltas]);

  const sendSubscribe = useCallback((ws: WebSocket) => {
    const { underlying: u, expiry: e, venues: v } = paramsRef.current;
    if (!u || !e) return;

    const subId = nextSubId();
    activeSubIdRef.current = subId;

    ws.send(
      JSON.stringify({
        type: 'subscribe',
        subscriptionId: subId,
        request: { underlying: u, expiry: e, venues: v },
      }),
    );
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      let json: unknown;
      try {
        json = JSON.parse(event.data as string);
      } catch {
        return;
      }

      const parsed = ServerWsMessageSchema.safeParse(json);
      if (!parsed.success) return;

      const msg = parsed.data;

      if ('subscriptionId' in msg && msg.subscriptionId !== activeSubIdRef.current) return;

      switch (msg.type) {
        case 'snapshot': {
          const key = chainKeys.chain(
            msg.request.underlying,
            msg.request.expiry,
            msg.request.venues,
          );
          qc.setQueryData(key, msg.data);
          store.set({ connectionState: 'live', staleMs: msg.meta.staleMs, lastSeq: msg.seq });
          break;
        }

        case 'delta': {
          const key = chainKeys.chain(
            msg.request.underlying,
            msg.request.expiry,
            msg.request.venues,
          );
          pendingRef.current.push({
            key,
            patch: msg.patch,
            seq: msg.seq,
            staleMs: msg.meta.staleMs,
          });
          scheduleFlush();
          break;
        }

        case 'subscribed':
          store.set({ connectionState: 'live', failedVenues: msg.failedVenues ?? [] });
          break;

        case 'status':
          switch (msg.state) {
            case 'connected':
              store.set({ connectionState: 'live' });
              break;
            case 'reconnecting':
            case 'polling':
              store.set({ connectionState: 'reconnecting' });
              break;
            case 'degraded':
              store.set({ connectionState: 'stale' });
              break;
            case 'down':
              store.set({ connectionState: 'error' });
              break;
          }
          break;

        case 'error':
          if (!msg.retryable) store.set({ connectionState: 'error' });
          break;
      }
    },
    [qc, store, scheduleFlush],
  );

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const envWsBase = import.meta.env.VITE_WS_URL;
    const wsUrl = envWsBase
      ? `${envWsBase.replace(/\/$/, '')}/ws/chain`
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/chain`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    store.set({ connectionState: 'connecting' });

    ws.onopen = () => {
      attemptRef.current = 0;
      sendSubscribe(ws);
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      wsRef.current = null;
      store.set({ connectionState: 'reconnecting' });
      scheduleReconnect();
    };

    ws.onerror = () => {
      store.set({ connectionState: 'error' });
    };
  }, [sendSubscribe, handleMessage, store]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectRef.current) return;
    if (attemptRef.current >= MAX_RETRIES) {
      store.set({ connectionState: 'error' });
      return;
    }
    const delay = backoffMs(attemptRef.current);
    attemptRef.current++;
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null;
      connect();
    }, delay);
  }, [connect, store]);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (rafRef.current != null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
      } else {
        clearTimeout(rafRef.current as unknown as ReturnType<typeof setTimeout>);
      }
      rafRef.current = null;
    }
    pendingRef.current = [];
    attemptRef.current = 0;
    activeSubIdRef.current = null;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000, 'unmount');
      wsRef.current = null;
    }
    store.set({ connectionState: 'closed' });
  }, [store]);

  // Connect / disconnect based on enabled + params. Crucially, do NOT tear
  // down the socket when only `underlying` or `expiry` change — the
  // resubscribe effect below pushes a new subscribe over the live socket.
  // Tearing down forced a closed → connecting → live cycle on every tenor
  // change, which made the FreshnessLabel ms display flicker visibly.
  useEffect(() => {
    if (!enabled || !underlying || !expiry) {
      disconnect();
      return;
    }
    // connect() is idempotent: it no-ops if the socket is already OPEN or
    // CONNECTING, so re-running on param change is safe.
    connect();
  }, [enabled, connect, disconnect, underlying, expiry]);

  // Tear down only when the hook itself unmounts.
  useEffect(() => () => disconnect(), [disconnect]);

  // Resubscribe on param change over an existing connection. When the socket
  // is still CONNECTING, the onopen handler will sendSubscribe using
  // paramsRef.current, which is updated every render.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !underlying || !expiry) return;
    sendSubscribe(ws);
  }, [underlying, expiry, venues, sendSubscribe]);

  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);

  return useMemo(
    () => ({
      connectionState: snapshot.connectionState,
      staleMs: snapshot.staleMs,
      lastSeq: snapshot.lastSeq,
      failedVenues: snapshot.failedVenues,
    }),
    [snapshot],
  );
}
