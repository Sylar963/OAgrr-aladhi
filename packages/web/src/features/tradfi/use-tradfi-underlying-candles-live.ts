import { tradfiWsUrl } from '@lib/tradfi-http';
import type { InstrumentCandleInterval } from '@oggregator/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

// Local Zod v4 schema (see use-tradfi-underlying-candles.ts — do NOT use the
// protocol's Zod v3 schemas inside a v4 z.object()).
const LiveBarSchema = z.object({
  type: z.literal('bar'),
  ts: z.number().int().nonnegative(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  vol: z.number(),
});

export type LiveBar = { ts: number; o: number; h: number; l: number; c: number; vol: number };
export type LiveConnectionState = 'closed' | 'connecting' | 'live' | 'reconnecting';

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

export function useTradfiUnderlyingCandlesLive(args: {
  underlying: string;
  interval: InstrumentCandleInterval;
  enabled?: boolean;
  onBar: (bar: LiveBar) => void;
}): { connectionState: LiveConnectionState } {
  const { underlying, interval, enabled = true, onBar } = args;

  const onBarRef = useRef(onBar);
  onBarRef.current = onBar;

  const [connectionState, setConnectionState] = useState<LiveConnectionState>('closed');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsRef = useRef({ underlying, interval });
  paramsRef.current = { underlying, interval };

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    const { underlying: u, interval: iv } = paramsRef.current;
    if (!u) return;
    const url = tradfiWsUrl(`/ws/underlying-candles?underlying=${encodeURIComponent(u)}&interval=${iv}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setConnectionState('connecting');

    ws.onopen = () => {
      attemptRef.current = 0;
      setConnectionState('live');
    };
    ws.onmessage = (event: MessageEvent) => {
      let json: unknown;
      try {
        json = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const parsed = LiveBarSchema.safeParse(json);
      if (!parsed.success) return;
      const { ts, o, h, l, c, vol } = parsed.data;
      onBarRef.current({ ts, o, h, l, c, vol });
    };
    ws.onclose = () => {
      wsRef.current = null;
      setConnectionState('reconnecting');
      scheduleReconnect();
    };
    ws.onerror = () => {};
  }, []);

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
      wsRef.current.onclose = null;
      wsRef.current.close(1000, 'unmount');
      wsRef.current = null;
    }
    setConnectionState('closed');
  }, []);

  // Reconnect when params change (underlying + interval are URL-encoded, so a
  // change needs a fresh socket) and tear down on unmount. React runs the
  // cleanup before re-running the effect, so an interval switch closes the old
  // socket before opening the new one.
  useEffect(() => {
    if (!enabled || !underlying) {
      disconnect();
      return;
    }
    connect();
    return () => disconnect();
  }, [enabled, underlying, interval, connect, disconnect]);

  return { connectionState };
}
