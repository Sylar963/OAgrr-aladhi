import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@lib/http";
import type { IvSurfaceResponse } from "@shared/enriched";

export const surfaceKeys = {
  surface: (underlying: string) => ["surface", underlying] as const,
};

export function useSurface(underlying: string) {
  return useQuery({
    queryKey: surfaceKeys.surface(underlying),
    queryFn:  () => fetchJson<IvSurfaceResponse>(`/surface?underlying=${underlying}`),
    enabled:  Boolean(underlying),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
