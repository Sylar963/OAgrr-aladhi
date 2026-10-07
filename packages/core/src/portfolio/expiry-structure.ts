import type { ExpiryRiskWindow, PositionLeg } from '@oggregator/protocol';

import {
  expiryInstantMs,
  intrinsicValue,
  markAtHorizon,
  yearsUntil,
} from './horizon-valuation.js';
import type { MarkContext } from './types.js';

export type { ExpiryRiskWindow } from '@oggregator/protocol';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

const GRID_STEPS = 400;
const GRID_SPOT_MULTIPLE = 3;
const SIZE_EPSILON = 1e-9;
// Keeps the lowest spot of a flat low instead of Black-76 round-off a few ulps below it.
const PNL_EPSILON_USD = 1e-6;
const BREAKEVEN_TOLERANCE_USD = 1;
const MAX_UPPER_DOUBLINGS = 20;

function spotAnchor(legsWithMarks: LegWithMark[]): number {
  const spots = legsWithMarks
    .map(({ mark }) => mark.underlyingPriceUsd ?? mark.forwardPriceUsd)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  if (spots.length > 0) return spots.reduce((sum, value) => sum + value, 0) / spots.length;
  return Math.max(...legsWithMarks.map(({ leg }) => leg.strike));
}

function spotGrid(legsWithMarks: LegWithMark[]): number[] {
  const maxSpot = spotAnchor(legsWithMarks) * GRID_SPOT_MULTIPLE;
  const grid = Array.from({ length: GRID_STEPS + 1 }, (_, index) => (maxSpot * index) / GRID_STEPS);
  for (const { leg } of legsWithMarks) grid.push(leg.strike);
  return [...new Set(grid)].sort((left, right) => left - right);
}

export function pnlAtHorizon(
  legsWithMarks: LegWithMark[],
  spotUsd: number,
  horizonMs: number,
): number | null {
  let pnlUsd = 0;
  for (const { leg, mark } of legsWithMarks) {
    // Black-76 at a zero forward collapses to intrinsic, which markAtHorizon rejects.
    const value =
      spotUsd > 0
        ? markAtHorizon(leg, mark, spotUsd, yearsUntil(leg.expiry, horizonMs))
        : intrinsicValue(0, leg.strike, leg.optionRight);
    if (value == null) return null;
    pnlUsd += (value - leg.entryPriceUsd) * leg.size;
  }
  return pnlUsd;
}

function pnlSign(pnlUsd: number): -1 | 0 | 1 {
  if (pnlUsd > PNL_EPSILON_USD) return 1;
  return pnlUsd < -PNL_EPSILON_USD ? -1 : 0;
}

function bisectBreakeven(
  pnlAt: (spotUsd: number) => number | null,
  lowSpotUsd: number,
  highSpotUsd: number,
  lowSign: -1 | 1,
): number | null {
  let low = lowSpotUsd;
  let high = highSpotUsd;
  while (high - low > BREAKEVEN_TOLERANCE_USD) {
    const mid = (low + high) / 2;
    const pnlUsd = pnlAt(mid);
    if (pnlUsd == null) return null;
    if (pnlSign(pnlUsd) === lowSign) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function findBreakevens(
  curve: Array<{ spotUsd: number; pnlUsd: number }>,
  pnlAt: (spotUsd: number) => number | null,
  pathCallSize: number,
): number[] | null {
  const breakevens: number[] = [];
  let last: { spotUsd: number; sign: -1 | 1 } | null = null;
  for (const { spotUsd, pnlUsd } of curve) {
    const sign = pnlSign(pnlUsd);
    if (sign === 0) continue;
    if (last != null && sign !== last.sign) {
      const crossing = bisectBreakeven(pnlAt, last.spotUsd, spotUsd, last.sign);
      if (crossing == null) return null;
      breakevens.push(crossing);
    }
    last = { spotUsd, sign };
  }

  // A far-OTM long call can break even above the grid; follow the upside slope out to it.
  const slopeSign = Math.abs(pathCallSize) < SIZE_EPSILON ? 0 : Math.sign(pathCallSize);
  if (last == null || slopeSign === 0 || slopeSign === last.sign) return breakevens;
  let low = last.spotUsd;
  let probe = curve[curve.length - 1]?.spotUsd ?? last.spotUsd;
  for (let step = 0; step < MAX_UPPER_DOUBLINGS; step += 1) {
    probe *= 2;
    const pnlUsd = pnlAt(probe);
    if (pnlUsd == null) return null;
    const sign = pnlSign(pnlUsd);
    if (sign === slopeSign) {
      const crossing = bisectBreakeven(pnlAt, low, probe, last.sign);
      if (crossing == null) return null;
      breakevens.push(crossing);
      break;
    }
    if (sign === last.sign) low = probe;
  }
  return breakevens;
}

/**
 * Risk and payoff per expiry window for a single-underlying book. Returns null
 * when a leg cannot be priced (no IV). Worst loss, best profit and breakevens
 * assume one spot path: legs that expired before the window's end settled at the
 * same spot that is evaluated at its end. Unboundedness does not rely on that
 * assumption, and once a window is unbounded every later window is too.
 * `pnlOffsetUsd` is added to every P&L value, e.g. minus proposed-leg fees.
 */
export function analyzeExpiryStructure(
  legsWithMarks: LegWithMark[],
  nowMs: number,
  pnlOffsetUsd = 0,
): ExpiryRiskWindow[] | null {
  const expiries = [...new Set(legsWithMarks.map(({ leg }) => leg.expiry))]
    .filter((expiry) => expiryInstantMs(expiry) > nowMs)
    .sort();
  if (expiries.length === 0) return [];

  const grid = spotGrid(legsWithMarks);
  // Every evaluated leg, including already-expired ones settled at intrinsic, sets the
  // single-path slope as spot rises; a negative slope makes any grid minimum an edge artifact.
  const pathCallSize = legsWithMarks.reduce(
    (sum, { leg }) => (leg.optionRight === 'call' ? sum + leg.size : sum),
    0,
  );
  const windows: ExpiryRiskWindow[] = [];
  let from = new Date(nowMs).toISOString();

  for (const until of expiries) {
    const horizonMs = expiryInstantMs(until);
    const pnlAt = (spotUsd: number) => {
      const pnlUsd = pnlAtHorizon(legsWithMarks, spotUsd, horizonMs);
      return pnlUsd == null ? null : pnlUsd + pnlOffsetUsd;
    };
    const live = legsWithMarks.filter(({ leg }) => leg.expiry >= until);
    const netCallSize = live.reduce(
      (sum, { leg }) => (leg.optionRight === 'call' ? sum + leg.size : sum),
      0,
    );
    // An earlier unbounded window settled at a spot this window cannot cap, so the
    // cumulative P&L at `until` stays unbounded even when the live calls are net long.
    const upsideUnbounded =
      netCallSize < -SIZE_EPSILON ||
      pathCallSize < -SIZE_EPSILON ||
      windows.some((window) => window.upsideUnbounded);
    const profitUnbounded =
      netCallSize > SIZE_EPSILON ||
      pathCallSize > SIZE_EPSILON ||
      windows.some((window) => window.bestProfitUsd == null);

    const curve: Array<{ spotUsd: number; pnlUsd: number }> = [];
    for (const spotUsd of grid) {
      const pnlUsd = pnlAt(spotUsd);
      if (pnlUsd == null) return null;
      curve.push({ spotUsd, pnlUsd });
    }
    const lossAtZeroSpotUsd = curve[0]?.pnlUsd;
    if (lossAtZeroSpotUsd == null) return null;

    let worstLossUsd: number | null = null;
    let worstLossSpotUsd: number | null = null;
    let bestProfitUsd: number | null = null;
    let bestProfitSpotUsd: number | null = null;
    for (const { spotUsd, pnlUsd } of curve) {
      if (!upsideUnbounded && (worstLossUsd == null || pnlUsd < worstLossUsd - PNL_EPSILON_USD)) {
        worstLossUsd = pnlUsd;
        worstLossSpotUsd = spotUsd;
      }
      if (!profitUnbounded && (bestProfitUsd == null || pnlUsd > bestProfitUsd + PNL_EPSILON_USD)) {
        bestProfitUsd = pnlUsd;
        bestProfitSpotUsd = spotUsd;
      }
    }

    const breakevenSpotsUsd = findBreakevens(curve, pnlAt, pathCallSize);
    if (breakevenSpotsUsd == null) return null;

    windows.push({
      from,
      until,
      liveLegIds: live.map(({ leg }) => leg.legId),
      netCallSize,
      upsideUnbounded,
      lossAtZeroSpotUsd,
      worstLossUsd,
      worstLossSpotUsd,
      bestProfitUsd,
      bestProfitSpotUsd,
      breakevenSpotsUsd,
    });
    from = until;
  }
  return windows;
}
