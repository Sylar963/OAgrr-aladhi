import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { createWebSocketTicket } from '@lib/account-session-api';
import { wsUrl } from '@lib/http';
import {
  type ChatClientMessage,
  type ChatMessageDto,
  ChatServerMessageSchema,
} from '@oggregator/protocol';
import { useCallback, useEffect, useReducer, useRef } from 'react';

export type ChatConnectionState = 'connecting' | 'live' | 'error' | 'closed';

export interface ChatState {
  connection: ChatConnectionState;
  messages: ChatMessageDto[];
  online: number;
  handle: string | null;
  anonAlias: string | null;
  mutedUntil: string | null;
  lastError: { code: string; message: string; at: number } | null;
}

type ChatAction =
  | { type: 'connection'; connection: ChatConnectionState }
  | { type: 'server'; message: ReturnType<typeof ChatServerMessageSchema.parse> };

const BASE_DELAY_MS = 1_500;
const MAX_RETRIES = 5;
const MAX_MESSAGES = 300;

export const INITIAL_CHAT_STATE: ChatState = {
  connection: 'closed',
  messages: [],
  online: 0,
  handle: null,
  anonAlias: null,
  mutedUntil: null,
  lastError: null,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'connection') return { ...state, connection: action.connection };
  const msg = action.message;
  switch (msg.type) {
    case 'hello':
      return {
        ...state,
        connection: 'live',
        online: msg.online,
        handle: msg.handle,
        anonAlias: msg.anonAlias,
        mutedUntil: msg.mutedUntil,
      };
    case 'history':
      return { ...state, messages: msg.messages };
    case 'message':
      return { ...state, messages: [...state.messages, msg.message].slice(-MAX_MESSAGES) };
    case 'deleted':
      return { ...state, messages: state.messages.filter((m) => m.id !== msg.id) };
    case 'presence':
      return { ...state, online: msg.online };
    case 'error':
      return { ...state, lastError: { code: msg.code, message: msg.message, at: Date.now() } };
  }
}

function socialWsUrl(ticket: string): string {
  const query = `?${new URLSearchParams({ ticket }).toString()}`;
  const envWsBase = import.meta.env.VITE_WS_URL;
  return envWsBase
    ? `${envWsBase.replace(/\/$/, '')}/ws/social${query}`
    : `${wsUrl('/ws/social')}${query}`;
}

/**
 * Global chat socket. The server ends private sockets every five minutes, so a clean close
 * reconnects with a fresh ticket and receives the history again.
 */
export function useSocialChat(enabled = true) {
  const session = useAccountSession();
  const [state, dispatch] = useReducer(chatReducer, INITIAL_CHAT_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!enabled || session.status !== 'ready') return;
    let disposed = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (disposed || timer != null) return;
      retries += 1;
      if (retries > MAX_RETRIES) {
        dispatch({ type: 'connection', connection: 'error' });
        return;
      }
      dispatch({ type: 'connection', connection: 'connecting' });
      timer = setTimeout(
        () => {
          timer = null;
          void connect();
        },
        Math.min(BASE_DELAY_MS * 2 ** (retries - 1), 30_000),
      );
    };

    const connect = async () => {
      if (disposed) return;
      dispatch({ type: 'connection', connection: 'connecting' });
      let ticket: string;
      try {
        ticket = await createWebSocketTicket();
      } catch {
        scheduleReconnect();
        return;
      }
      if (disposed) return;
      const ws = new WebSocket(socialWsUrl(ticket));
      wsRef.current = ws;
      ws.onmessage = (event) => {
        let raw: unknown;
        try {
          raw = JSON.parse(event.data as string);
        } catch {
          return;
        }
        const parsed = ChatServerMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        if (parsed.data.type === 'hello') retries = 0;
        dispatch({ type: 'server', message: parsed.data });
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!disposed) scheduleReconnect();
      };
    };

    void connect();

    return () => {
      disposed = true;
      if (timer != null) clearTimeout(timer);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.close(1000, 'unmount');
      }
      dispatch({ type: 'connection', connection: 'closed' });
    };
  }, [enabled, session.status, session.userId, attempt]);

  const send = useCallback((message: ChatClientMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }, []);

  return { state, send, reconnect: retry };
}
