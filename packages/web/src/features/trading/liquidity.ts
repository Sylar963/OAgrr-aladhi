import type { PositionLeg } from '@features/portfolio';
import { fetchJson } from '@lib/http';
import type { LiquidityResponse } from '@oggregator/protocol';

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

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Thalex option symbol for a portfolio leg: BTC-23OCT26-84000-C. */
export function thalexOptionSymbol(leg: Pick<PositionLeg, 'underlying' | 'expiry' | 'strike' | 'optionRight'>): string {
  const [year, month, day] = leg.expiry.split('-');
  const monthName = MONTHS[Number(month) - 1] ?? '';
  return `${leg.underlying.toUpperCase()}-${day}${monthName}${year?.slice(2)}-${leg.strike}-${leg.optionRight === 'call' ? 'C' : 'P'}`;
}

export const LIQUIDITY_DEFAULT_INSTRUMENTS = ['BTC-PERPETUAL', 'ETH-PERPETUAL'];
