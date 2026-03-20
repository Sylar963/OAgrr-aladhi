import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { EnrichedChainResponse } from "@shared/enriched";
import { chainKeys } from "@features/chain/queries";

type WsStatus = "connecting" | "open" | "closed" | "error";

interface UseChainWsOptions {
  underlying: string;
  expiry: string;
  venues: string[];
  enabled?: boolean;
  onStatus?: (status: WsStatus) => void;
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

/**
 * Subscribes to real-time chain updates via server WebSocket.
 * Pushes snapshots directly into TanStack Query cache so components
 * consuming `useChainQuery` get live data without polling.
 */
export function useChainWs({
  underlying,
  expiry,
  venues,
  enabled = true,
  onStatus,
}: UseChainWsOptions) {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track current subscription params so reconnect resends the right message
  const paramsRef = useRef({ underlying, expiry, venues });
  paramsRef.current = { underlying, expiry, venues };

  const queryKey = chainKeys.chain(underlying, expiry, venues);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/chain`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    onStatus?.("connecting");

    ws.onopen = () => {
      attemptRef.current = 0;
      onStatus?.("open");

      const { underlying: u, expiry: e, venues: v } = paramsRef.current;
      if (u && e) {
        ws.send(JSON.stringify({
          type: "subscribe",
          underlying: u,
          expiry: e,
          venues: v.length > 0 ? v : undefined,
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;

        if (msg["type"] === "snapshot") {
          const data = msg["data"] as EnrichedChainResponse;
          const key = chainKeys.chain(
            data.underlying,
            data.expiry,
            paramsRef.current.venues,
          );
          qc.setQueryData(key, data);
        }
      } catch { /* malformed JSON from server */ }
    };

    ws.onclose = () => {
      onStatus?.("closed");
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      onStatus?.("error");
    };
  }, [qc, onStatus]);

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
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent reconnect on intentional close
      wsRef.current.close(1000, "unmount");
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !underlying || !expiry) {
      disconnect();
      return;
    }

    connect();
    return () => disconnect();
  }, [enabled, underlying, expiry, connect, disconnect]);

  // Resubscribe when params change on an existing connection
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !underlying || !expiry) return;

    ws.send(JSON.stringify({
      type: "subscribe",
      underlying,
      expiry,
      venues: venues.length > 0 ? venues : undefined,
    }));
  }, [underlying, expiry, venues]);

  return { queryKey };
}
