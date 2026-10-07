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

function pnlAtHorizon(legsWithMarks: LegWithMark[], spotUsd: number, horizonMs: number): number | null {
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

/**
 * Risk per expiry window for a single-underlying book. Returns null when a
 * leg cannot be priced (no IV). Worst loss assumes one spot path: legs that
 * expired before the window's end settled at the same spot that is evaluated
 * at its end. Unboundedness does not rely on that assumption, and once a
 * window is unbounded every later window is too.
 */
export function analyzeExpiryStructure(
  legsWithMarks: LegWithMark[],
  nowMs: number,
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

    const lossAtZeroSpotUsd = pnlAtHorizon(legsWithMarks, 0, horizonMs);
    if (lossAtZeroSpotUsd == null) return null;

    let worstLossUsd: number | null = null;
    let worstLossSpotUsd: number | null = null;
    if (!upsideUnbounded) {
      worstLossUsd = lossAtZeroSpotUsd;
      worstLossSpotUsd = 0;
      for (const spotUsd of grid) {
        if (spotUsd === 0) continue;
        const pnlUsd = pnlAtHorizon(legsWithMarks, spotUsd, horizonMs);
        if (pnlUsd == null) return null;
        if (pnlUsd < worstLossUsd - PNL_EPSILON_USD) {
          worstLossUsd = pnlUsd;
          worstLossSpotUsd = spotUsd;
        }
      }
    }

    windows.push({
      from,
      until,
      liveLegIds: live.map(({ leg }) => leg.legId),
      netCallSize,
      upsideUnbounded,
      lossAtZeroSpotUsd,
      worstLossUsd,
      worstLossSpotUsd,
    });
    from = until;
  }
  return windows;
}
