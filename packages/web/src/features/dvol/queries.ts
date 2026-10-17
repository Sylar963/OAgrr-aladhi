import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { VolHeatmapResponse } from '@oggregator/protocol';

import { fetchJson } from '@lib/http';
import { mergeHeatmapTail, type HeatmapWindow } from './heatmap-model';

const HEATMAP_POLL_MS = 15_000;
const HOUR_MS = 3_600_000;

/** Polls only the tail after the first load; the server re-sends the slot that was still filling. */
export function useVolHeatmap(currency: string, window: HeatmapWindow) {
  const queryClient = useQueryClient();
  const queryKey = ['vol-heatmap', currency, window.hours, window.resolutionSec] as const;
  return useQuery({
    queryKey,
    queryFn: async () => {
      const prev = queryClient.getQueryData<VolHeatmapResponse>(queryKey);
      const lastT = prev?.columns.at(-1)?.t;
      const params = new URLSearchParams({
        currency,
        hours: String(window.hours),
        resolutionSec: String(window.resolutionSec),
      });
      if (lastT != null) params.set('since', String(lastT));
      const next = await fetchJson<VolHeatmapResponse>(`/vol-heatmap?${params}`);
      if (prev == null || lastT == null) return next;
      return {
        ...next,
        columns: mergeHeatmapTail(prev.columns, next.columns, next.asOf - window.hours * HOUR_MS),
      };
    },
    refetchInterval: HEATMAP_POLL_MS,
    staleTime: HEATMAP_POLL_MS / 2,
  });
}

export interface DvolCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HvPoint {
  timestamp: number;
  value: number;
}

interface DvolHistoryResponse {
  currency: string;
  count: number;
  candles: DvolCandle[];
  hv: HvPoint[];
}

export function useDvolHistory(currency: string) {
  return useQuery({
    queryKey: ['dvol-history', currency],
    queryFn: () => fetchJson<DvolHistoryResponse>(`/dvol-history?currency=${currency}`),
    enabled: Boolean(currency),
    staleTime: 5 * 60_000,
  });
}
