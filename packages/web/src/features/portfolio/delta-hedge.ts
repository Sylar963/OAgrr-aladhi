import { DELTA_HEDGE_TOLERANCE_COIN } from '@oggregator/protocol';

export const DELTA_DIGITS = 3;

export type DeltaHedgeState = 'hedged' | 'offsetting' | 'long' | 'short' | 'unknown';

export function deltaHedgeState(
  netDeltaCoin: number | null,
  optionsDeltaCoin?: number | null,
  linearDeltaCoin = 0,
): DeltaHedgeState {
  if (netDeltaCoin == null) return 'unknown';
  if (Math.abs(netDeltaCoin) < DELTA_HEDGE_TOLERANCE_COIN) return 'hedged';
  if (optionsDeltaCoin != null && optionsDeltaCoin * linearDeltaCoin < 0) return 'offsetting';
  return netDeltaCoin > 0 ? 'long' : 'short';
}
