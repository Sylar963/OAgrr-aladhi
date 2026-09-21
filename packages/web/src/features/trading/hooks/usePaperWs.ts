import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { createWebSocketTicket } from '@lib/account-session-api';
import { wsUrl } from '@lib/http';
import type { PaperOverviewDto, PaperWsServerMessage } from '@oggregator/protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { getPaperAccountScope } from '../api';
import { QKEY } from './queries';

type PaperConnectionState = 'connecting' | 'live' | 'closed' | 'error';

const BASE_DELAY = 1_500;
const MAX_RETRIES = 5;

export function usePaperWs(accountScope?: string | null, enabled = true): PaperConnectionState {
  const qc = useQueryClient();
  const accountSession = useAccountSession();
  const defaultAccountId = accountSession.accountId;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const [state, setState] = useState<PaperConnectionState>('closed');

  useEffect(() => {
    if (!enabled || accountSession.status !== 'ready' || defaultAccountId == null) return;
    let disposed = false;

    const connect = async () => {
      if (disposed) return;
      let ticket: string;
      try {
        ticket = await createWebSocketTicket();
      } catch {
        scheduleReconnect();
        return;
      }
      if (disposed) return;
      const params = new URLSearchParams({ ticket });
      const acct = accountScope ?? getPaperAccountScope();
      if (acct) params.set('accountId', acct);
      const query = `?${params.toString()}`;
      const envWsBase = import.meta.env.VITE_WS_URL;
      const paperWsUrl = envWsBase
        ? `${envWsBase.replace(/\/$/, '')}/ws/paper${query}`
        : `${wsUrl('/ws/paper')}${query}`;
      const cacheAccountId = acct ?? defaultAccountId;
      const ws = new WebSocket(paperWsUrl);
      wsRef.current = ws;
      setState('connecting');

      ws.onopen = () => {
        retryCountRef.current = 0;
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
            qc.setQueryData(QKEY.positions(cacheAccountId), { positions: message.positions });
            break;
          case 'pnl':
            qc.setQueryData(QKEY.pnl(cacheAccountId), message.pnl);
            qc.setQueryData<PaperOverviewDto>(QKEY.overview(cacheAccountId), (current) =>
              current == null ? current : { ...current, pnl: message.pnl },
            );
            break;
          case 'order':
            qc.invalidateQueries({ queryKey: QKEY.orders(cacheAccountId) });
            qc.invalidateQueries({ queryKey: QKEY.fills(cacheAccountId) });
            qc.invalidateQueries({ queryKey: QKEY.trades(cacheAccountId) });
            qc.invalidateQueries({ queryKey: QKEY.activity(cacheAccountId) });
            qc.invalidateQueries({ queryKey: QKEY.overview(cacheAccountId) });
            break;
          case 'trade':
            qc.setQueryData([...QKEY.trade(cacheAccountId), message.trade.id], message.trade);
            qc.invalidateQueries({ queryKey: QKEY.trades(cacheAccountId) });
            qc.invalidateQueries({ queryKey: QKEY.activity(cacheAccountId) });
            qc.invalidateQueries({ queryKey: QKEY.overview(cacheAccountId) });
            break;
          case 'activity':
            qc.invalidateQueries({ queryKey: QKEY.activity(cacheAccountId) });
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
        scheduleReconnect();
      };

      ws.onerror = () => {
        setState('error');
      };
    };

    function scheduleReconnect() {
      if (disposed || reconnectRef.current != null) return;
      retryCountRef.current++;
      if (retryCountRef.current > MAX_RETRIES) {
        setState('error');
        return;
      }
      const delay = Math.min(BASE_DELAY * 2 ** (retryCountRef.current - 1), 30_000);
      setState('connecting');
      reconnectRef.current = setTimeout(() => {
        reconnectRef.current = null;
        void connect();
      }, delay);
    }

    void connect();

    return () => {
      disposed = true;
      retryCountRef.current = 0;
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
  }, [accountScope, accountSession.status, defaultAccountId, enabled, qc]);

  return state;
}
