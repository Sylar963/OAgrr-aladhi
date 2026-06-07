import type { SettlementComputation, TestRouteOutcome } from './types.js';

export function evaluateTestRoute(
  equityUsd: number,
  depositUsd: number,
  profitTargetPct: number,
  maxDrawdownPct: number,
): TestRouteOutcome {
  const passLevel = depositUsd * (1 + profitTargetPct);
  const failLevel = depositUsd * (1 - maxDrawdownPct);
  if (equityUsd >= passLevel) return { result: 'pass' };
  if (equityUsd <= failLevel) return { result: 'fail' };
  return { result: 'continue' };
}

export function evaluateFundedFloor(
  equityUsd: number,
  abcCredited: number,
  abcFloorPct: number,
): boolean {
  return equityUsd < abcCredited * abcFloorPct;
}

export function accrueRevShare(
  equityUsd: number,
  abcCredited: number,
  profitSplitPct: number,
): number {
  const cumulativeProfit = equityUsd - abcCredited;
  return profitSplitPct * Math.max(0, cumulativeProfit);
}

export function computeSettlement(
  equityUsd: number,
  abcCredited: number,
  abcFloorPct: number,
  profitSplitPct: number,
): SettlementComputation {
  const cumulativeProfitUsd = equityUsd - abcCredited;
  const traderShareUsd = profitSplitPct * Math.max(0, cumulativeProfitUsd);
  const drawdownPct = abcCredited > 0 ? Math.max(0, (abcCredited - equityUsd) / abcCredited) : 0;
  const floorBreached = evaluateFundedFloor(equityUsd, abcCredited, abcFloorPct);
  return { cumulativeProfitUsd, traderShareUsd, drawdownPct, floorBreached };
}
