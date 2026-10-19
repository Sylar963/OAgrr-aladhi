import { fetchJson } from '@lib/http';
import type { LiquidityResponse } from '@oggregator/protocol';

export { thalexOptionSymbol } from '@lib/thalex-symbol';

export type LiquiditySide = 'buy' | 'sell';

export interface LiquidityRequest {
  instrument: string;
  side: LiquiditySide;
  size: number;
}

export function fetchLiquidity(request: LiquidityRequest): Promise<LiquidityResponse> {
  const params = new URLSearchParams({
    instrument: request.instrument,
    side: request.side,
    size: String(request.size),
  });
  return fetchJson<LiquidityResponse>(`/liquidity?${params.toString()}`);
}

export const LIQUIDITY_DEFAULT_INSTRUMENTS = ['BTC-PERPETUAL', 'ETH-PERPETUAL'];
