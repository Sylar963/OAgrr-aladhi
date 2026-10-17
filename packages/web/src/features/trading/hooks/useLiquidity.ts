import { useQuery } from '@tanstack/react-query';
import { fetchLiquidity, type LiquidityRequest } from '../liquidity';

const REFRESH_MS = 2_000;

/** Polls the server's live book estimate while a request is set; the server keeps the book warm. */
export function useLiquidity(request: LiquidityRequest | null) {
  return useQuery({
    queryKey: ['liquidity', request?.instrument, request?.side, request?.size],
    queryFn: () => fetchLiquidity(request!),
    enabled: request !== null,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
