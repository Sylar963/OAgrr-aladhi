import { useInfiniteQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { fetchJson } from '@lib/http';

export const NEWS_WINDOWS = [
  { id: 'latest', label: 'Latest' },
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '1y', label: '1Y' },
] as const;

export type NewsWindow = (typeof NEWS_WINDOWS)[number]['id'];

const NewsItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  url: z.string(),
  source: z.string(),
  handle: z.string().nullable(),
  ruleTag: z.string().nullable(),
  timestamp: z.number(),
  createdAt: z.string(),
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
