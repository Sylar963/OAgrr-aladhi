import type {
  EntryVolDrift,
  ShockGridCell,
  ShockGridMeta,
  VolShockLegResult,
  VolShockResult,
  VolShockScenario,
} from '@oggregator/protocol';

import { legMarkFromShockedIv } from './aggregator.js';
import type { MarkContext, PositionLeg } from './types.js';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

function dteYears(expiry: string, nowMs: number): number | null {
  const target = Date.parse(`${expiry}T08:00:00.000Z`);
  if (!Number.isFinite(target)) return null;
  const secs = (target - nowMs) / 1000;
  return secs > 0 ? secs / (365 * 24 * 60 * 60) : null;
}

export function applyVolShock(
  scenario: VolShockScenario,
  currentIv: number,
  strike: number,
  expiry: string,
  nowMs: number,
): number {
  switch (scenario.kind) {
    case 'parallel':
      return currentIv + scenario.bumpVolPts / 100;
    case 'skew_tilt': {
      const logK = Math.log(strike / scenario.atmStrike);
      return currentIv + scenario.slopePerLogK * logK;
    }
    case 'term_twist': {
      const ty = dteYears(expiry, nowMs);
      if (ty == null) return currentIv;
      const pivotY = scenario.pivotDays / 365;
      return currentIv + scenario.slopePerYear * (ty - pivotY);
    }
    case 'atm_bump': {
      const distance = (strike - scenario.atmStrike) / (scenario.atmStrike * scenario.widthPct);
      const weight = Math.exp(-distance * distance);
      return currentIv + (weight * scenario.bumpVolPts) / 100;
    }
    default: {
      const _exhaustive: never = scenario;
      return currentIv + (_exhaustive as never);
    }
  }
}

export function computeShockPnl(
  scenario: VolShockScenario,
  legsWithMarks: LegWithMark[],
  nowMs: number,
): VolShockResult {
  const byLeg: VolShockLegResult[] = [];
  let totalPnlUsd = 0;

  for (const { leg, mark } of legsWithMarks) {
    if (mark.iv == null || mark.markPriceUsd == null) continue;

    const bumpedIv = applyVolShock(scenario, mark.iv, leg.strike, leg.expiry, nowMs);
    const safeIv = bumpedIv > 0 ? bumpedIv : 0.001;
    const bumpedMarkUsd = legMarkFromShockedIv(leg, mark, safeIv);
    if (bumpedMarkUsd == null) continue;

    const legPnl = (bumpedMarkUsd - mark.markPriceUsd) * leg.size;
    totalPnlUsd += legPnl;
    byLeg.push({
      legId: leg.legId,
      pnlUsd: legPnl,
      bumpedIv: safeIv,
      bumpedMarkUsd,
    });
  }

  return { scenario, totalPnlUsd, byLeg };
}

const ATM_SHIFT_VOL_PTS = [-10, -5, -2.5, -1, 0, 1, 2.5, 5, 10];
const SKEW_SHIFT_PER_LOG_K = [-0.5, -0.25, -0.1, -0.05, 0, 0.05, 0.1, 0.25, 0.5];

export function computeShockGrid(
  legsWithMarks: LegWithMark[],
  nowMs: number,
  _legacyAtmStrike?: number,
): ShockGridCell[][] {
  return buildShockGrid(legsWithMarks, nowMs, (_leg, mark) => mark.iv);
}

// Shocks are applied to each leg's entry IV rather than its live IV, but every cell is
// still the change from the current model value, so "now" sits at the entry drift.
export function computeEntryShockGrid(
  legsWithMarks: LegWithMark[],
  nowMs: number,
): ShockGridCell[][] {
  return buildShockGrid(legsWithMarks, nowMs, entryAnchorIv);
}

function entryAnchorIv(leg: PositionLeg, mark: MarkContext): number | null {
  return leg.entryIv != null && leg.entryIv > 0 ? leg.entryIv : mark.iv;
}

function buildShockGrid(
  legsWithMarks: LegWithMark[],
  nowMs: number,
  anchorIv: (leg: PositionLeg, mark: MarkContext) => number | null,
): ShockGridCell[][] {
  const grid: ShockGridCell[][] = [];

  for (const atmShift of ATM_SHIFT_VOL_PTS) {
    const row: ShockGridCell[] = [];
    for (const skewShift of SKEW_SHIFT_PER_LOG_K) {
      let totalPnlUsd = 0;
      for (const { leg, mark } of legsWithMarks) {
        if (mark.iv == null || mark.forwardPriceUsd == null) continue;
        const anchor = anchorIv(leg, mark);
        if (anchor == null) continue;

        const baseModelUsd = legMarkFromShockedIv(leg, mark, mark.iv);
        if (baseModelUsd == null) continue;

        const parallelBumped = applyVolShock(
          { kind: 'parallel', bumpVolPts: atmShift },
          anchor,
          leg.strike,
          leg.expiry,
          nowMs,
        );
        const skewBumped = applyVolShock(
          { kind: 'skew_tilt', atmStrike: mark.forwardPriceUsd, slopePerLogK: skewShift },
          parallelBumped,
          leg.strike,
          leg.expiry,
          nowMs,
        );
        const safeIv = skewBumped > 0 ? skewBumped : 0.001;
        const bumpedMarkUsd = legMarkFromShockedIv(leg, mark, safeIv);
        if (bumpedMarkUsd == null) continue;
        totalPnlUsd += (bumpedMarkUsd - baseModelUsd) * leg.size;
      }
      row.push({ atmShiftVolPts: atmShift, skewShiftPerLogK: skewShift, totalPnlUsd });
    }
    grid.push(row);
  }

  return grid;
}

// Below ~2% log-moneyness dispersion a slope fit is noise, so the drift is all ATM.
const MIN_SKEW_FIT_STD_LOG_K = 0.02;
const ENTRY_SOURCES = new Set<PositionLeg['source']>(['manual', 'paper']);

export function computeEntryVolDrift(legsWithMarks: LegWithMark[]): EntryVolDrift | null {
  const points: Array<{ x: number; d: number; w: number }> = [];
  let volPnlUsd = 0;
  let entryLegs = 0;
  let firstSeenLegs = 0;

  for (const { leg, mark } of legsWithMarks) {
    if (leg.entryIv == null || leg.entryIv <= 0) continue;
    if (mark.iv == null || mark.forwardPriceUsd == null || mark.forwardPriceUsd <= 0) continue;
    const nowModelUsd = legMarkFromShockedIv(leg, mark, mark.iv);
    const entryModelUsd = legMarkFromShockedIv(leg, mark, leg.entryIv);
    if (nowModelUsd == null || entryModelUsd == null) continue;

    volPnlUsd += (nowModelUsd - entryModelUsd) * leg.size;
    points.push({
      x: Math.log(leg.strike / mark.forwardPriceUsd),
      d: mark.iv - leg.entryIv,
      w: Math.abs((mark.vega ?? 0) * leg.size),
    });
    if (ENTRY_SOURCES.has(leg.source) || leg.entryIvSource === 'fill') entryLegs += 1;
    else firstSeenLegs += 1;
  }

  if (points.length === 0) return null;
  if (points.every((p) => !(p.w > 0))) for (const p of points) p.w = 1;

  const sumW = points.reduce((acc, p) => acc + p.w, 0);
  const meanX = points.reduce((acc, p) => acc + p.w * p.x, 0) / sumW;
  const meanD = points.reduce((acc, p) => acc + p.w * p.d, 0) / sumW;
  const sxx = points.reduce((acc, p) => acc + p.w * (p.x - meanX) ** 2, 0);
  const sxd = points.reduce((acc, p) => acc + p.w * (p.x - meanX) * (p.d - meanD), 0);
  const fitSkew = sxx / sumW >= MIN_SKEW_FIT_STD_LOG_K ** 2;
  const slope = fitSkew ? sxd / sxx : 0;
  const atm = meanD - slope * meanX;

  return {
    atmShiftVolPts: atm * 100,
    skewShiftPerLogK: slope,
    volPnlUsd,
    anchoredLegs: points.length,
    basis: firstSeenLegs === 0 ? 'entry' : entryLegs === 0 ? 'first_seen' : 'mixed',
  };
}

export function getShockGridMeta(legsWithMarks: LegWithMark[]): ShockGridMeta {
  const excludedLegIds: string[] = [];

  for (const { leg, mark } of legsWithMarks) {
    if (mark.iv == null || legMarkFromShockedIv(leg, mark, mark.iv) == null) {
      excludedLegIds.push(leg.legId);
    }
  }

  return {
    totalLegs: legsWithMarks.length,
    pricedLegs: legsWithMarks.length - excludedLegIds.length,
    excludedLegIds,
    anchor: 'per_leg_forward',
  };
}
