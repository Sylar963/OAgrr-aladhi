import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { VolHeatmapResponse } from '@oggregator/protocol';

import { fetchJson } from '@lib/http';
import { mergeHeatmapTail, type HeatmapWindow } from './heatmap-model';

const HEATMAP_POLL_MS = 15_000;
const HOUR_MS = 3_600_000;

/**
 * Polls only the tail after the first load; the server re-sends the slot that was still filling.
 * The server picks the resolution from how much data the window holds, so when that changes the
 * tail no longer lines up with the cached columns and the whole window is refetched.
 */
export function useVolHeatmap(currency: string, window: HeatmapWindow) {
  const queryClient = useQueryClient();
  const queryKey = ['vol-heatmap', currency, window.hours] as const;
  return useQuery({
    queryKey,
    queryFn: async () => {
      const base = `/vol-heatmap?currency=${currency}&hours=${window.hours}`;
      const prev = queryClient.getQueryData<VolHeatmapResponse>(queryKey);
      const lastT = prev?.columns.at(-1)?.t;
      if (prev == null || lastT == null) return fetchJson<VolHeatmapResponse>(base);
      const next = await fetchJson<VolHeatmapResponse>(`${base}&since=${lastT}`);
      if (next.resolutionSec !== prev.resolutionSec) return fetchJson<VolHeatmapResponse>(base);
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
