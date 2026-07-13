import { fetchJson } from '@lib/http';
import type { FlowTrade, FlowTradeHistoryCursor } from '@oggregator/protocol';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export type TradeEvent = FlowTrade;

interface FlowResponse {
  underlying: string;
  count: number;
  trades: TradeEvent[];
}

export type TradeHistoryCursor = FlowTradeHistoryCursor;

interface FlowHistoryResponse {
  available: boolean;
  trades: TradeEvent[];
  nextCursor: TradeHistoryCursor | null;
}

export interface HistorySummaryVenue {
  venue: string;
  count: number;
  premiumUsd: number;
  notionalUsd: number;
}

export interface HistorySummary {
  available: boolean;
  count: number;
  premiumUsd: number;
  notionalUsd: number;
  oldestTs: string | null;
  newestTs: string | null;
  venues: HistorySummaryVenue[];
}

export interface HistoryRange {
  start: string | null;
  end: string | null;
}

export interface HistoryPageQuery {
  underlying: string;
  venues: string[];
  range: HistoryRange;
  cursor?: TradeHistoryCursor | null;
  limit?: number;
}

export function useFlow(underlying: string, enabled = true) {
  return useQuery({
    queryKey: ['flow', underlying],
    queryFn: () => fetchJson<FlowResponse>(`/flow?underlying=${underlying}&limit=200`),
    enabled: Boolean(underlying) && enabled,
    refetchInterval: 2_000,
  });
}

export function useFlowHistorySummary(
  underlying: string,
  venues: string[],
  range: HistoryRange,
  enabled = true,
) {
  const query = useMemo(
    () => buildHistoryParams({ underlying, venues, range }),
    [range, underlying, venues],
  );

  return useQuery({
    queryKey: ['flow-history-summary', underlying, venues.join(','), range.start, range.end],
    queryFn: () => fetchJson<HistorySummary>(`/flow/history/summary?${query.toString()}`),
    enabled: Boolean(underlying) && enabled,
  });
}

export function useFlowHistoryPage(query: HistoryPageQuery, enabled = true) {
  const params = useMemo(() => buildHistoryParams(query), [query]);

  return useQuery({
    queryKey: [
      'flow-history-page',
      query.underlying,
      query.venues.join(','),
      query.range.start,
      query.range.end,
      query.cursor?.beforeTs ?? null,
      query.cursor?.beforeUid ?? null,
      query.limit ?? 100,
    ],
    queryFn: () => fetchJson<FlowHistoryResponse>(`/flow/history?${params.toString()}`),
    enabled: Boolean(query.underlying) && enabled,
  });
}

function buildHistoryParams(
  query: HistoryPageQuery | { underlying: string; venues: string[]; range: HistoryRange },
): URLSearchParams {
  const params = new URLSearchParams({ underlying: query.underlying });
  if (query.venues.length > 0) params.set('venues', query.venues.join(','));
  if (query.range.start) params.set('start', query.range.start);
  if (query.range.end) params.set('end', query.range.end);
  if ('cursor' in query && query.cursor) {
    params.set('beforeTs', query.cursor.beforeTs);
    params.set('beforeUid', query.cursor.beforeUid);
  }
  if ('limit' in query && query.limit) params.set('limit', String(query.limit));
  return params;
}
