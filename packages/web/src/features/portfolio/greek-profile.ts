import type { BreakEvenIvRow, PositionLeg } from '@oggregator/protocol';

import { black76Price, normCdf, normPdf } from '@lib/analytics/blackScholes';
import { defineMessages, translate, type Locale } from '@lib/i18n';

import type { StrikeRiskMode } from './strike-risk';

export type SpotProfileMode = Exclude<StrikeRiskMode, 'volga'>;

const messages = defineMessages(
  { now: 'Now', lastDay: '+{n}d · 1d left' },
  { now: 'Ahora', lastDay: '+{n}d · queda 1d' },
);

export interface ProfileLeg {
  strike: number;
  expiry: string;
  optionRight: 'call' | 'put';
  size: number;
  iv: number;
}

export interface LegGreeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  vanna: number;
  volga: number;
}

export interface ProfileHorizon {
  days: number;
  label: string;
}

export interface ProfileSeries extends ProfileHorizon {
  values: number[];
}

export interface SpotProfile {
  prices: number[];
  series: ProfileSeries[];
}

export interface VolShockProfile {
  shiftsVolPts: number[];
  fullPnlUsd: number[];
  vegaOnlyPnlUsd: number[];
}

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;
const SPOT_POINTS = 121;
const MIN_SIGMA = 0.01;
export const VOL_SHOCK_RANGE_PTS = 20;

function daysUntilExpiry(expiry: string, nowMs: number): number {
  const target = Date.parse(`${expiry}T08:00:00.000Z`);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, (target - nowMs) / DAY_MS);
}

export function yearsUntilExpiry(expiry: string, nowMs: number): number {
  return daysUntilExpiry(expiry, nowMs) / YEAR_DAYS;
}

// Sticky strike: each leg keeps its live IV wherever spot goes; legs with no usable IV
// are left out and counted so the chart can say the curve is partial.
export function buildProfileLegs(
  positions: PositionLeg[],
  breakEven: BreakEvenIvRow[],
  expiry: string | null,
): { legs: ProfileLeg[]; excluded: number } {
  const liveIv = new Map(breakEven.map((row) => [row.legId, row.currentIv]));
  const legs: ProfileLeg[] = [];
  let excluded = 0;
  for (const leg of positions) {
    if (expiry != null && leg.expiry !== expiry) continue;
    const iv = liveIv.get(leg.legId) ?? leg.entryIv;
    if (iv == null || !(iv > 0)) {
      excluded += 1;
      continue;
    }
    legs.push({
      strike: leg.strike,
      expiry: leg.expiry,
      optionRight: leg.optionRight,
      size: leg.size,
      iv,
    });
  }
  return { legs, excluded };
}

function d1(forward: number, strike: number, sigma: number, tYears: number): number {
  return (Math.log(forward / strike) + 0.5 * sigma * sigma * tYears) / (sigma * Math.sqrt(tYears));
}

// Same units as the server's per-strike rows: vega per vol point, theta per day,
// vanna as delta per vol point, volga as dollars per vol point squared.
export function greeks76(
  forward: number,
  strike: number,
  sigma: number,
  tYears: number,
  right: 'call' | 'put',
): LegGreeks {
  if (!(forward > 0 && strike > 0 && sigma > 0 && tYears > 0)) {
    const itm = right === 'call' ? forward > strike : forward < strike;
    return {
      delta: itm ? (right === 'call' ? 1 : -1) : 0,
      gamma: 0,
      vega: 0,
      theta: 0,
      vanna: 0,
      volga: 0,
    };
  }
  const sqrtT = Math.sqrt(tYears);
  const _d1 = d1(forward, strike, sigma, tYears);
  const _d2 = _d1 - sigma * sqrtT;
  const density = normPdf(_d1);
  const vegaPerUnit = forward * sqrtT * density;
  return {
    delta: right === 'call' ? normCdf(_d1) : normCdf(_d1) - 1,
    gamma: density / (forward * sigma * sqrtT),
    vega: vegaPerUnit / 100,
    theta: -(forward * density * sigma) / (2 * sqrtT) / YEAR_DAYS,
    vanna: (-density * _d2) / sigma / 100,
    volga: (vegaPerUnit * _d1 * _d2) / sigma / 10_000,
  };
}

// Now, halfway, and the last day before settlement: the three moments where gamma and
// theta visibly change shape. Horizons collapse when the expiry is too close for them.
export function profileHorizons(
  expiry: string,
  nowMs: number,
  locale: Locale = 'en',
): ProfileHorizon[] {
  const daysLeft = daysUntilExpiry(expiry, nowMs);
  const horizons: ProfileHorizon[] = [
    { days: 0, label: translate(messages, 'now', undefined, locale) },
  ];
  const halfway = Math.round(daysLeft / 2);
  const lastDay = Math.floor(daysLeft - 1);
  if (daysLeft > 4 && halfway > 0) horizons.push({ days: halfway, label: `+${halfway}d` });
  if (daysLeft > 2 && lastDay > (horizons[horizons.length - 1]?.days ?? 0)) {
    horizons.push({ days: lastDay, label: translate(messages, 'lastDay', { n: lastDay }, locale) });
  }
  return horizons;
}

// About 2.5 standard deviations of the move to expiry, so deltas reach their ±1 tails
// without a long-dated book stretching the axis into meaningless prices.
export function spotProfileRange(
  legs: ProfileLeg[],
  spotUsd: number,
  nowMs: number,
): [number, number] {
  const strikes = legs.map((leg) => leg.strike);
  const lo = Math.min(...strikes, spotUsd);
  const hi = Math.max(...strikes, spotUsd);
  const moveFraction = Math.max(
    ...legs.map((leg) => 2.5 * leg.iv * Math.sqrt(yearsUntilExpiry(leg.expiry, nowMs))),
  );
  const pad = Math.max((hi - lo) * 0.35, spotUsd * Math.min(0.6, Math.max(0.1, moveFraction)));
  return [Math.max(1, lo - pad), hi + pad];
}

function profileValue(mode: SpotProfileMode, greeks: LegGreeks, priceUsd: number): number {
  // Raw gamma per $1 is unreadable on BTC; delta change per 1% move at that price is not.
  return mode === 'gamma' ? greeks.gamma * priceUsd * 0.01 : greeks[mode];
}

export function buildSpotProfile(
  legs: ProfileLeg[],
  mode: SpotProfileMode,
  spotUsd: number,
  nowMs: number,
  locale: Locale = 'en',
): SpotProfile {
  if (legs.length === 0 || !(spotUsd > 0)) return { prices: [], series: [] };
  const [minPrice, maxPrice] = spotProfileRange(legs, spotUsd, nowMs);
  const step = (maxPrice - minPrice) / (SPOT_POINTS - 1);
  // Near expiry gamma and theta peak exactly at the strike; sample it so the peak is not cut.
  const prices = [
    ...Array.from({ length: SPOT_POINTS }, (_, index) => minPrice + step * index),
    ...legs.map((leg) => leg.strike).filter((strike) => strike > minPrice && strike < maxPrice),
    spotUsd,
  ]
    .sort((left, right) => left - right)
    .filter((price, index, sorted) => index === 0 || price - sorted[index - 1]! > 1e-6);

  const expiry = legs[0]!.expiry;
  const series = profileHorizons(expiry, nowMs, locale).map((horizon) => {
    const horizonMs = nowMs + horizon.days * DAY_MS;
    const values = prices.map((priceUsd) =>
      legs.reduce((sum, leg) => {
        const tYears = yearsUntilExpiry(leg.expiry, horizonMs);
        const greeks = greeks76(priceUsd, leg.strike, leg.iv, tYears, leg.optionRight);
        return sum + profileValue(mode, greeks, priceUsd) * leg.size;
      }, 0),
    );
    return { ...horizon, values };
  });
  return { prices, series };
}

// Full repricing against the vega-only straight line: the gap between them is volga.
export function buildVolShockProfile(
  legs: ProfileLeg[],
  spotUsd: number,
  nowMs: number,
): VolShockProfile {
  const shiftsVolPts = Array.from(
    { length: VOL_SHOCK_RANGE_PTS * 2 + 1 },
    (_, index) => index - VOL_SHOCK_RANGE_PTS,
  );
  if (legs.length === 0 || !(spotUsd > 0)) {
    return { shiftsVolPts: [], fullPnlUsd: [], vegaOnlyPnlUsd: [] };
  }
  const priced = legs.map((leg) => {
    const tYears = yearsUntilExpiry(leg.expiry, nowMs);
    return {
      leg,
      tYears,
      base: black76Price(leg.optionRight, spotUsd, leg.strike, tYears, leg.iv),
      vega: greeks76(spotUsd, leg.strike, leg.iv, tYears, leg.optionRight).vega,
    };
  });
  const fullPnlUsd = shiftsVolPts.map((shift) =>
    priced.reduce((sum, { leg, tYears, base }) => {
      const sigma = Math.max(MIN_SIGMA, leg.iv + shift / 100);
      const shocked = black76Price(leg.optionRight, spotUsd, leg.strike, tYears, sigma);
      return sum + (shocked - base) * leg.size;
    }, 0),
  );
  const vegaOnlyPnlUsd = shiftsVolPts.map((shift) =>
    priced.reduce((sum, { leg, vega }) => sum + vega * shift * leg.size, 0),
  );
  return { shiftsVolPts, fullPnlUsd, vegaOnlyPnlUsd };
}
