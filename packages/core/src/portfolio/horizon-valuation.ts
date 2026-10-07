import type { PositionLeg } from '@oggregator/protocol';

import { price76 } from '../feeds/thalex/bs-solver.js';

import type { MarkContext } from './types.js';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export function expiryInstantMs(expiry: string): number {
  return Date.parse(`${expiry}T08:00:00.000Z`);
}

export function yearsUntil(expiry: string, nowMs: number): number {
  const target = expiryInstantMs(expiry);
  if (!Number.isFinite(target)) return 0;
  const seconds = (target - nowMs) / 1000;
  return seconds > 0 ? seconds / YEAR_SECONDS : 0;
}

export function intrinsicValue(
  underlyingPriceUsd: number,
  strike: number,
  right: PositionLeg['optionRight'],
): number {
  return right === 'call'
    ? Math.max(0, underlyingPriceUsd - strike)
    : Math.max(0, strike - underlyingPriceUsd);
}

export function markAtHorizon(
  leg: PositionLeg,
  mark: MarkContext,
  underlyingPriceUsd: number,
  tYears: number,
): number | null {
  if (!(underlyingPriceUsd > 0)) return null;
  if (!(tYears > 0)) return intrinsicValue(underlyingPriceUsd, leg.strike, leg.optionRight);
  const sigma = mark.iv ?? leg.entryIv ?? null;
  if (!(sigma != null && sigma > 0)) return null;
  return price76(underlyingPriceUsd, leg.strike, sigma, tYears, leg.optionRight);
}
