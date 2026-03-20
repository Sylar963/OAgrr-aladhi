import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { ServerWsMessage, WsConnectionState } from "@shared/enriched";
import { chainKeys } from "@features/chain/queries";

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
}

let subIdCounter = 0;
function nextSubId(): string {
  return `sub-${++subIdCounter}-${Date.now()}`;
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

/**
 * Subscribes to real-time chain updates via server WebSocket.
 * Pushes snapshots into TanStack Query cache, keyed from the server's
 * response (not local mutable state) to prevent stale-snapshot races.
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

  const [connectionState, setConnectionState] = useState<WsConnectionState>("closed");
  const [staleMs, setStaleMs] = useState<number | null>(null);
  const [lastSeq, setLastSeq] = useState(0);

  const paramsRef = useRef({ underlying, expiry, venues });
  paramsRef.current = { underlying, expiry, venues };

  const sendSubscribe = useCallback((ws: WebSocket) => {
    const { underlying: u, expiry: e, venues: v } = paramsRef.current;
    if (!u || !e) return;

    const subId = nextSubId();
    activeSubIdRef.current = subId;

    ws.send(JSON.stringify({
      type: "subscribe",
      subscriptionId: subId,
      request: {
        underlying: u,
        expiry: e,
        venues: v,
      },
    }));
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: ServerWsMessage;
    try { msg = JSON.parse(event.data as string) as ServerWsMessage; }
    catch { return; }

    if ("subscriptionId" in msg && msg.subscriptionId !== activeSubIdRef.current) return;

    if (msg.type === "snapshot") {
      setConnectionState("live");
      setStaleMs(msg.meta.staleMs);
      setLastSeq(msg.seq);

      // Key from server's request, not local mutable params
      const key = chainKeys.chain(msg.request.underlying, msg.request.expiry, msg.request.venues);
      qc.setQueryData(key, msg.data);
    }

    if (msg.type === "subscribed") {
      setConnectionState("live");
    }

    if (msg.type === "status") {
      if (msg.state === "reconnecting" || msg.state === "degraded") {
        setConnectionState("stale");
      }
    }

    if (msg.type === "error" && !msg.retryable) {
      setConnectionState("error");
    }
  }, [qc]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/chain`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setConnectionState("connecting");

    ws.onopen = () => {
      attemptRef.current = 0;
      sendSubscribe(ws);
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      wsRef.current = null;
      setConnectionState("reconnecting");
      scheduleReconnect();
    };

    ws.onerror = () => {
      setConnectionState("error");
    };
  }, [sendSubscribe, handleMessage]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectRef.current) return;
    const delay = backoffMs(attemptRef.current);
    attemptRef.current++;
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    attemptRef.current = 0;
    activeSubIdRef.current = null;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000, "unmount");
      wsRef.current = null;
    }
    setConnectionState("closed");
  }, []);

  useEffect(() => {
    if (!enabled || !underlying || !expiry) {
      disconnect();
      return;
    }
    connect();
    return () => disconnect();
  }, [enabled, connect, disconnect, underlying, expiry]);

  // Resubscribe on param change over an existing connection
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !underlying || !expiry) return;
    sendSubscribe(ws);
  }, [underlying, expiry, venues, sendSubscribe]);

  return { connectionState, staleMs, lastSeq };
}
