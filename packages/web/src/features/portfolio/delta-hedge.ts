// Options delta moves continuously, so "zero" means net delta rounds to 0.000 coin,
// the precision it is shown at.
export const DELTA_HEDGE_TOLERANCE_COIN = 0.0005;
export const DELTA_DIGITS = 3;

export type DeltaHedgeState = 'hedged' | 'long' | 'short';

export function deltaHedgeState(netDeltaCoin: number): DeltaHedgeState {
  if (Math.abs(netDeltaCoin) < DELTA_HEDGE_TOLERANCE_COIN) return 'hedged';
  return netDeltaCoin > 0 ? 'long' : 'short';
}
