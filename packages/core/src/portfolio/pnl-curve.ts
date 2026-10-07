import type {
  ExpiryBasis,
  PortfolioPnlCurve,
  PortfolioPnlCurveStatus,
  PortfolioPnlPoint,
  PositionLeg,
} from '@oggregator/protocol';

import { analyzeExpiryStructure } from './expiry-structure.js';
import { intrinsicValue, markAtHorizon, yearsUntil } from './horizon-valuation.js';
import type { MarkContext } from './types.js';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

const CURVE_POINTS = 61;
const DAY_MS = 86_400_000;

function average(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function interpolateZero(
  leftX: number,
  leftY: number,
  rightX: number,
  rightY: number,
): number | null {
  const spanY = rightY - leftY;
  if (!Number.isFinite(spanY) || Math.abs(spanY) < 1e-9) return null;
  const weight = -leftY / spanY;
  if (!(weight >= 0 && weight <= 1)) return null;
  return leftX + (rightX - leftX) * weight;
}

function dedupeSorted(values: number[], epsilon = 1e-6): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const deduped: number[] = [];
  for (const value of sorted) {
    const last = deduped[deduped.length - 1];
    if (last == null || Math.abs(last - value) > epsilon) deduped.push(value);
  }
  return deduped;
}

function breakEvenPrices(points: PortfolioPnlPoint[]): number[] {
  const prices: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point == null) continue;
    if (Math.abs(point.expiryPnlUsd) < 1e-9) prices.push(point.underlyingPriceUsd);
    const next = points[index + 1];
    if (next == null) continue;
    if ((point.expiryPnlUsd < 0 && next.expiryPnlUsd > 0) || (point.expiryPnlUsd > 0 && next.expiryPnlUsd < 0)) {
      const crossing = interpolateZero(
        point.underlyingPriceUsd,
        point.expiryPnlUsd,
        next.underlyingPriceUsd,
        next.expiryPnlUsd,
      );
      if (crossing != null) prices.push(crossing);
    }
  }
  return dedupeSorted(prices);
}

function hasPlateau(values: number[], target: number, tolerance: number): boolean {
  for (let index = 0; index < values.length - 1; index += 1) {
    const left = values[index];
    const right = values[index + 1];
    if (left == null || right == null) continue;
    if (Math.abs(left - target) <= tolerance && Math.abs(right - target) <= tolerance) {
      return true;
    }
  }
  return false;
}

function buildPriceRange(legsWithMarks: LegWithMark[], currentSpotUsd: number | null): [number, number] {
  const strikes = legsWithMarks.map(({ leg }) => leg.strike);
  const minAnchor = Math.min(...strikes, currentSpotUsd ?? Number.POSITIVE_INFINITY);
  const maxAnchor = Math.max(...strikes, currentSpotUsd ?? 0);
  const anchor = currentSpotUsd ?? average(strikes) ?? Math.max(1, maxAnchor);
  const padding = Math.max((maxAnchor - minAnchor) * 0.35, anchor * 0.2, 250);
  const minPrice = Math.max(1, minAnchor - padding);
  const maxPrice = Math.max(minPrice + 1, maxAnchor + padding);
  return [minPrice, maxPrice];
}

function unavailableCurve(
  status: Exclude<PortfolioPnlCurveStatus, 'ok'>,
  underlying: string | null,
  currentSpotUsd: number | null,
  expiryBasis: ExpiryBasis,
): PortfolioPnlCurve {
  return {
    status,
    underlying,
    currentSpotUsd,
    breakEvenPricesUsd: [],
    maxProfitUsd: null,
    maxLossUsd: null,
    upsideBounded: false,
    downsideBounded: false,
    points: [],
    expiryBasis,
    riskWindows: [],
  };
}

export function buildPortfolioPnlCurve(
  legsWithMarks: LegWithMark[],
  nowMs: number,
  forwardDays: number,
): PortfolioPnlCurve {
  const expiryBasis: ExpiryBasis =
    new Set(legsWithMarks.map(({ leg }) => leg.expiry)).size > 1 ? 'mixed_expiry' : 'common_expiry';
  if (legsWithMarks.length === 0) return unavailableCurve('empty', null, null, expiryBasis);

  const underlying = legsWithMarks[0]?.leg.underlying ?? null;
  if (underlying == null || legsWithMarks.some(({ leg }) => leg.underlying !== underlying)) {
    return unavailableCurve('mixed_underlyings', null, null, expiryBasis);
  }

  const currentSpotUsd = average(
    legsWithMarks.map(({ mark }) => mark.underlyingPriceUsd ?? mark.forwardPriceUsd),
  );
  const [minPrice, maxPrice] = buildPriceRange(legsWithMarks, currentSpotUsd);
  const priceStep = (maxPrice - minPrice) / (CURVE_POINTS - 1);
  // Expiry payoff only bends at strikes, so sampling them keeps its corners exact.
  const samplePrices = dedupeSorted([
    ...Array.from({ length: CURVE_POINTS }, (_, index) => minPrice + priceStep * index),
    ...legsWithMarks.map(({ leg }) => leg.strike).filter((strike) => strike > minPrice && strike < maxPrice),
  ]);
  const forwardNowMs = nowMs + Math.max(0, forwardDays) * DAY_MS;
  const points: PortfolioPnlPoint[] = [];

  for (const underlyingPriceUsd of samplePrices) {
    let nowPnlUsd = 0;
    let forwardPnlUsd = 0;
    let expiryPnlUsd = 0;

    for (const { leg, mark } of legsWithMarks) {
      const nowValue = markAtHorizon(leg, mark, underlyingPriceUsd, yearsUntil(leg.expiry, nowMs));
      if (nowValue == null) {
        return unavailableCurve('missing_marks', underlying, currentSpotUsd, expiryBasis);
      }

      const forwardValue =
        forwardDays > 0
          ? markAtHorizon(leg, mark, underlyingPriceUsd, yearsUntil(leg.expiry, forwardNowMs))
          : nowValue;
      if (forwardValue == null) {
        return unavailableCurve('missing_marks', underlying, currentSpotUsd, expiryBasis);
      }

      const expiryValue = intrinsicValue(underlyingPriceUsd, leg.strike, leg.optionRight);
      nowPnlUsd += (nowValue - leg.entryPriceUsd) * leg.size;
      forwardPnlUsd += (forwardValue - leg.entryPriceUsd) * leg.size;
      expiryPnlUsd += (expiryValue - leg.entryPriceUsd) * leg.size;
    }

    points.push({
      underlyingPriceUsd,
      nowPnlUsd,
      forwardPnlUsd: forwardDays > 0 ? forwardPnlUsd : null,
      expiryPnlUsd,
    });
  }

  const riskWindows = analyzeExpiryStructure(legsWithMarks, nowMs);
  if (riskWindows == null) {
    return unavailableCurve('missing_marks', underlying, currentSpotUsd, expiryBasis);
  }

  const expiryValues = points.map((point) => point.expiryPnlUsd);
  const maxProfitUsd = Math.max(...expiryValues);
  const curveLowUsd = Math.min(...expiryValues);
  const maxAbs = Math.max(...expiryValues.map((value) => Math.abs(value)), 1);
  const plateauTolerance = Math.max(1, maxAbs * 0.01);
  const first = expiryValues[0] ?? 0;
  const second = expiryValues[1] ?? first;
  const last = expiryValues[expiryValues.length - 1] ?? 0;
  const prev = expiryValues[expiryValues.length - 2] ?? last;

  let maxLossUsd = hasPlateau(expiryValues, curveLowUsd, plateauTolerance) ? curveLowUsd : null;
  let upsideBounded = Math.abs(last - prev) <= plateauTolerance;
  // A common settlement spot hides risk that opens once an earlier expiry settles,
  // so mixed-expiry books take their loss bound from the per-expiry windows.
  if (expiryBasis === 'mixed_expiry' && riskWindows.length > 0) {
    if (riskWindows.some((window) => window.upsideUnbounded)) {
      maxLossUsd = null;
      upsideBounded = false;
    } else {
      maxLossUsd = Math.min(...riskWindows.flatMap((window) => window.worstLossUsd ?? []));
    }
  }

  return {
    status: 'ok',
    underlying,
    currentSpotUsd,
    breakEvenPricesUsd: breakEvenPrices(points),
    maxProfitUsd: hasPlateau(expiryValues, maxProfitUsd, plateauTolerance) ? maxProfitUsd : null,
    maxLossUsd,
    upsideBounded,
    downsideBounded: Math.abs(second - first) <= plateauTolerance,
    points,
    expiryBasis,
    riskWindows,
  };
}

export interface PortfolioHorizonScenarioCell {
  horizonDays: number;
  spotMovePct: number;
  spotUsd: number;
  pnlUsd: number;
  pnlByExpiryUsd: Record<string, number>;
}

export interface PortfolioHorizonScenarios {
  status: PortfolioPnlCurve['status'];
  underlying: string | null;
  currentSpotUsd: number | null;
  ivAssumption: 'current_iv_held_constant';
  horizonsDays: number[];
  spotMovesPct: number[];
  cells: PortfolioHorizonScenarioCell[];
}

export function buildPortfolioHorizonScenarios(
  legsWithMarks: LegWithMark[],
  nowMs: number,
  horizonsDays: number[],
  spotMovesPct: number[],
): PortfolioHorizonScenarios {
  const horizons = dedupeSorted(horizonsDays.filter((days) => days >= 0));
  const moves = dedupeSorted(spotMovesPct);
  const base = {
    ivAssumption: 'current_iv_held_constant' as const,
    horizonsDays: horizons,
    spotMovesPct: moves,
  };
  if (legsWithMarks.length === 0) {
    return { ...base, status: 'empty', underlying: null, currentSpotUsd: null, cells: [] };
  }
  const underlying = legsWithMarks[0]?.leg.underlying ?? null;
  if (underlying == null || legsWithMarks.some(({ leg }) => leg.underlying !== underlying)) {
    return { ...base, status: 'mixed_underlyings', underlying: null, currentSpotUsd: null, cells: [] };
  }
  const currentSpotUsd = average(
    legsWithMarks.map(({ mark }) => mark.underlyingPriceUsd ?? mark.forwardPriceUsd),
  );
  if (currentSpotUsd == null) {
    return { ...base, status: 'missing_marks', underlying, currentSpotUsd: null, cells: [] };
  }

  const cells: PortfolioHorizonScenarioCell[] = [];
  for (const horizonDays of horizons) {
    const horizonMs = nowMs + horizonDays * DAY_MS;
    for (const spotMovePct of moves) {
      const spotUsd = currentSpotUsd * (1 + spotMovePct / 100);
      let pnlUsd = 0;
      const pnlByExpiryUsd: Record<string, number> = {};
      for (const { leg, mark } of legsWithMarks) {
        const value = markAtHorizon(leg, mark, spotUsd, yearsUntil(leg.expiry, horizonMs));
        if (value == null) {
          return { ...base, status: 'missing_marks', underlying, currentSpotUsd, cells: [] };
        }
        const legPnlUsd = (value - leg.entryPriceUsd) * leg.size;
        pnlUsd += legPnlUsd;
        pnlByExpiryUsd[leg.expiry] = (pnlByExpiryUsd[leg.expiry] ?? 0) + legPnlUsd;
      }
      cells.push({ horizonDays, spotMovePct, spotUsd, pnlUsd, pnlByExpiryUsd });
    }
  }
  return { ...base, status: 'ok', underlying, currentSpotUsd, cells };
}
