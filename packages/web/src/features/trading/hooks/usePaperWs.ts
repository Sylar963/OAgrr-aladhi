import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PaperWsServerMessage } from '@oggregator/protocol';
import { QKEY } from './queries';

type PaperConnectionState = 'connecting' | 'live' | 'closed' | 'error';

export function usePaperWs(enabled = true): PaperConnectionState {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTradeRefreshRef = useRef(0);
  const [state, setState] = useState<PaperConnectionState>('closed');

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/paper`);
      wsRef.current = ws;
      setState('connecting');

      ws.onopen = () => {
        setState('live');
      };

      ws.onmessage = (event) => {
        let message: PaperWsServerMessage | null = null;
        try {
          message = JSON.parse(event.data as string) as PaperWsServerMessage;
        } catch {
          return;
        }
        if (!message) return;

        switch (message.type) {
          case 'positions':
            qc.setQueryData(QKEY.positions, { positions: message.positions });
            break;
          case 'pnl':
            qc.setQueryData(QKEY.pnl, message.pnl);
            qc.invalidateQueries({ queryKey: QKEY.overview });
            if (Date.now() - lastTradeRefreshRef.current >= 5_000) {
              lastTradeRefreshRef.current = Date.now();
              qc.invalidateQueries({ queryKey: QKEY.trades });
              qc.invalidateQueries({ queryKey: QKEY.trade });
            }
            break;
          case 'order':
            qc.invalidateQueries({ queryKey: QKEY.orders });
            qc.invalidateQueries({ queryKey: QKEY.fills });
            qc.invalidateQueries({ queryKey: QKEY.trades });
            qc.invalidateQueries({ queryKey: QKEY.activity });
            qc.invalidateQueries({ queryKey: QKEY.overview });
            break;
          case 'trade':
            qc.setQueryData([...QKEY.trade, message.trade.id], message.trade);
            qc.invalidateQueries({ queryKey: QKEY.trades });
            qc.invalidateQueries({ queryKey: QKEY.activity });
            qc.invalidateQueries({ queryKey: QKEY.overview });
            break;
          case 'activity':
            qc.invalidateQueries({ queryKey: QKEY.activity });
            break;
          case 'hello':
            break;
          case 'error':
            setState('error');
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (disposed) {
          setState('closed');
          return;
        }
        setState('connecting');
        reconnectRef.current = setTimeout(connect, 1_500);
      };

      ws.onerror = () => {
        setState('error');
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, 'unmount');
        wsRef.current = null;
      }
      setState('closed');
    };
  }, [enabled, qc]);

  return state;
}
