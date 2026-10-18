import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { getClerkToken } from '@lib/clerk-token';
import { fetchJson } from '@lib/http';
import {
  type NewsPinsResponse,
  NewsPinsResponseSchema,
  type NewsRelevance,
} from '@oggregator/protocol';

export const NEWS_WINDOWS = [
  { id: 'latest', label: 'Latest' },
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '1y', label: '1Y' },
] as const;

export type NewsWindow = (typeof NEWS_WINDOWS)[number]['id'];

// Protocol schemas are zod 3 and cannot nest in this zod 4 object; the annotation keeps them in step.
const NewsRelevanceSchema: z.ZodType<NewsRelevance> = z.object({
  score: z.number(),
  tier: z.enum(['critical', 'watch', 'normal']),
  tags: z.array(z.string()),
  pinId: z.string().nullable(),
  repeat: z.boolean(),
});

const NewsItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  url: z.string(),
  source: z.string(),
  handle: z.string().nullable(),
  ruleTag: z.string().nullable(),
  timestamp: z.number(),
  createdAt: z.string(),
  // Optional so a SPA cached against an older server keeps rendering.
  relevance: NewsRelevanceSchema.optional(),
});

const NewsPageSchema = z.object({
  items: z.array(NewsItemSchema),
  nextCursor: z.string().nullable(),
});

export type ArchivedNewsItem = z.infer<typeof NewsItemSchema>;

const PAGE_SIZE = 48;

export function useNewsArchive(window: NewsWindow) {
  return useInfiniteQuery({
    queryKey: ['news', 'archive', window],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ window, limit: String(PAGE_SIZE) });
      if (pageParam) params.set('cursor', pageParam);
      return NewsPageSchema.parse(await fetchJson<unknown>(`/news/archive?${params}`));
    },
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
const PINS_KEY = ['news', 'pins'] as const;

export function useNewsPins() {
  return useQuery({
    queryKey: PINS_KEY,
    queryFn: async () => NewsPinsResponseSchema.parse(await fetchJson<unknown>('/news/pins')),
    staleTime: 60_000,
  });
}

async function sendPinChange(method: 'POST' | 'DELETE', id: string): Promise<NewsPinsResponse> {
  const token = await getClerkToken();
  const path = method === 'POST' ? '/news/pins' : `/news/pins/${encodeURIComponent(id)}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify({ id }) } : {}),
  });
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return NewsPinsResponseSchema.parse(payload);
}

export function usePinMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      sendPinChange(pinned ? 'DELETE' : 'POST', id),
    onSuccess: (data) => {
      qc.setQueryData(PINS_KEY, data);
      // Every score is relative to the pins, so the feeds have to be re-ranked.
      void qc.invalidateQueries({ queryKey: ['news'], predicate: (q) => q.queryKey[1] !== 'pins' });
    },
  });
}
