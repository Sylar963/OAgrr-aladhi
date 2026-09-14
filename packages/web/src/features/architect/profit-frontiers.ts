import { black76Price } from '@lib/analytics/blackScholes';

import type { Leg } from './payoff';

const DEFAULT_IV = 0.5;
const MAX_FRONTIER_POINTS = 240;
const MIN_IV = 0.01;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

export interface ProfitFrontierPoint {
  timestamp: number;
  price: number;
}

export interface ProfitFrontier {
  kind: 'base' | 'scenario';
  iv: number;
  ivShiftPct: number;
  points: ProfitFrontierPoint[];
}

function solveCallBreakEven(strike: number, premium: number, iv: number, tYears: number): number {
  if (tYears <= 0) return strike + premium;

  let low = Math.max(strike * 0.01, Number.EPSILON);
  let high = Math.max(strike + premium, strike * 1.25);
  while (black76Price('call', high, strike, tYears, iv) < premium) high *= 2;

  for (let iteration = 0; iteration < 64; iteration++) {
    const mid = (low + high) / 2;
    if (black76Price('call', mid, strike, tYears, iv) < premium) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function buildFrontier(
  leg: Leg,
  anchorTimeMs: number,
  expiryTimeMs: number,
  resolutionSec: number,
  ivShiftPct: number,
  kind: ProfitFrontier['kind'],
): ProfitFrontier {
  const baseIv = leg.iv != null && Number.isFinite(leg.iv) && leg.iv > 0 ? leg.iv : DEFAULT_IV;
  const iv = Math.max(MIN_IV, baseIv + ivShiftPct / 100);
  const spanMs = expiryTimeMs - anchorTimeMs;
  const requestedPoints = Math.ceil(spanMs / (resolutionSec * 1000));
  const pointCount = Math.min(MAX_FRONTIER_POINTS, Math.max(2, requestedPoints));
  const points = Array.from({ length: pointCount + 1 }, (_, index) => {
    const fraction = index / pointCount;
    const timestamp = anchorTimeMs + spanMs * fraction;
    const tYears = Math.max(0, (expiryTimeMs - timestamp) / MS_PER_YEAR);
    return {
      timestamp,
      price: solveCallBreakEven(leg.strike, leg.entryPrice, iv, tYears),
    };
  });

  return { kind, iv, ivShiftPct, points };
}

export function computeLongCallProfitFrontiers(
  legs: Leg[],
  anchorTimeMs: number,
  expiryTimeMs: number,
  resolutionSec: number,
  scenarioIvShiftPct: number,
): ProfitFrontier[] {
  const leg = legs[0];
  if (
    legs.length !== 1 ||
    leg == null ||
    leg.type !== 'call' ||
    leg.direction !== 'buy' ||
    !Number.isFinite(leg.strike) ||
    !Number.isFinite(leg.entryPrice) ||
    leg.strike <= 0 ||
    leg.entryPrice <= 0 ||
    resolutionSec <= 0 ||
    !Number.isFinite(anchorTimeMs) ||
    !Number.isFinite(expiryTimeMs) ||
    expiryTimeMs <= anchorTimeMs
  ) {
    return [];
  }

  const base = buildFrontier(leg, anchorTimeMs, expiryTimeMs, resolutionSec, 0, 'base');
  if (scenarioIvShiftPct === 0) return [base];

  return [
    base,
    buildFrontier(
      leg,
      anchorTimeMs,
      expiryTimeMs,
      resolutionSec,
      scenarioIvShiftPct,
      'scenario',
    ),
  ];
}
