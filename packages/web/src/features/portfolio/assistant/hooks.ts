import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type {
  PortfolioAssistantMessage,
  PortfolioAssistantStreamEvent,
  PortfolioSource,
} from '@oggregator/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createPortfolioAssistantThread,
  deletePortfolioAssistantThread,
  fetchPortfolioAssistantAccess,
  fetchPortfolioAssistantMessages,
  fetchPortfolioAssistantThreads,
  streamPortfolioAssistantMessage,
} from './api';

export const PORTFOLIO_ASSISTANT_QKEY = {
  access: (accountId: string) =>
    ['account', accountId, 'portfolio', 'assistant', 'access'] as const,
  threads: (accountId: string, source: PortfolioSource, underlying: string | null) =>
    [
      'account',
      accountId,
      'portfolio',
      'assistant',
      'threads',
      source,
      underlying ?? 'all',
    ] as const,
  messages: (accountId: string, threadId: string) =>
    ['account', accountId, 'portfolio', 'assistant', 'messages', threadId] as const,
};

export function usePortfolioAssistantAccess() {
  const session = useAccountSession();
  return useQuery({
    queryKey: PORTFOLIO_ASSISTANT_QKEY.access(session.accountId ?? 'unresolved'),
    queryFn: fetchPortfolioAssistantAccess,
    enabled: session.status === 'ready',
    staleTime: 30_000,
    retry: false,
  });
}

export interface PortfolioAssistantThreadState {
  threadId: string | null;
  isLoading: boolean;
  error: Error | null;
  startNewChat: () => Promise<void>;
}

export function usePortfolioAssistantThread(
  source: PortfolioSource,
  underlying: string | null,
  enabled = true,
): PortfolioAssistantThreadState {
  const session = useAccountSession();
  const queryClient = useQueryClient();
  const accountId = session.accountId ?? 'unresolved';
  const key = PORTFOLIO_ASSISTANT_QKEY.threads(accountId, source, underlying);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const existing = await fetchPortfolioAssistantThreads(source, underlying);
      return existing.threads[0] ?? createPortfolioAssistantThread({ source, underlying });
    },
    enabled: enabled && session.status === 'ready',
    retry: false,
  });

  const startNewChat = useCallback(async () => {
    if (query.data?.threadId) await deletePortfolioAssistantThread(query.data.threadId);
    await queryClient.invalidateQueries({ queryKey: key });
  }, [key, query.data?.threadId, queryClient]);

  return {
    threadId: query.data?.threadId ?? null,
    isLoading: query.isLoading,
    error: query.error,
    startNewChat,
  };
}

export interface PortfolioAssistantConversationState {
  messages: PortfolioAssistantMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  sendMessage: (message: string, forwardDays: number) => Promise<void>;
  stop: () => void;
}

export function usePortfolioAssistantConversation(
  threadId: string | null,
): PortfolioAssistantConversationState {
  const session = useAccountSession();
  const queryClient = useQueryClient();
  const accountId = session.accountId ?? 'unresolved';
  const key = PORTFOLIO_ASSISTANT_QKEY.messages(accountId, threadId ?? 'none');
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchPortfolioAssistantMessages(threadId!),
    enabled: threadId != null && session.status === 'ready',
    retry: false,
  });
  const [messages, setMessages] = useState<PortfolioAssistantMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMessages(query.data?.messages ?? []);
  }, [query.data?.messages, threadId]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const onEvent = useCallback((event: PortfolioAssistantStreamEvent) => {
    if (event.type === 'message_started') {
      setMessages((current) =>
        current.some((item) => item.messageId === event.assistantMessageId)
          ? current
          : [
              ...current,
              {
                messageId: event.assistantMessageId,
                role: 'assistant',
                content: '',
                status: 'streaming',
                portfolioGeneratedAt: event.portfolioGeneratedAt,
                createdAt: Date.now(),
              },
            ],
      );
    } else if (event.type === 'text_delta') {
      setMessages((current) =>
        current.map((item) =>
          item.messageId === event.assistantMessageId
            ? { ...item, content: item.content + event.delta }
            : item,
        ),
      );
    } else if (event.type === 'message_completed' || event.type === 'message_cancelled') {
      setMessages((current) =>
        current.map((item) =>
          item.messageId === event.assistantMessageId
            ? { ...item, status: event.type === 'message_completed' ? 'complete' : 'cancelled' }
            : item,
        ),
      );
    } else if (event.type === 'error') {
      setError(event.message);
      setMessages((current) =>
        current.map((item) => (item.status === 'streaming' ? { ...item, status: 'failed' } : item)),
      );
    }
  }, []);

  const sendMessage = useCallback(
    async (message: string, forwardDays: number) => {
      if (!threadId || isStreaming) return;
      const content = message.trim();
      if (!content) return;
      const clientMessageId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        {
          messageId: clientMessageId,
          role: 'user',
          content,
          status: 'complete',
          portfolioGeneratedAt: null,
          createdAt: Date.now(),
        },
      ]);
      setError(null);
      setIsStreaming(true);
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        await streamPortfolioAssistantMessage(
          threadId,
          { clientMessageId, message: content, forwardDays },
          controller.signal,
          onEvent,
        );
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setError(caught instanceof Error ? caught.message : 'Could not ask Hermes.');
        }
      } finally {
        controllerRef.current = null;
        setIsStreaming(false);
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [isStreaming, key, onEvent, queryClient, threadId],
  );

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  return { messages, isLoading: query.isLoading, isStreaming, error, sendMessage, stop };
}
