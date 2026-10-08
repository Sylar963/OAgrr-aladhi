import type { PositionLeg } from '@oggregator/protocol';

import { solveIv } from '../feeds/thalex/bs-solver.js';

export interface EntryFill {
  direction: 'buy' | 'sell';
  amount: number;
  priceUsd: number;
  timestampMs: number;
  underlyingPriceUsd: number | null;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function yearsToExpiryAt(expiry: string, timestampMs: number): number | null {
  const expiryMs = Date.parse(`${expiry}T08:00:00.000Z`);
  if (!Number.isFinite(expiryMs) || expiryMs <= timestampMs) return null;
  return (expiryMs - timestampMs) / YEAR_MS;
}

// Amount-weighted IV of the fills that still make up the open position, walking
// back from the newest opening fill (LIFO). Underlying price at the fill stands in
// for the forward. Returns null unless fills cover the whole open size, so a
// position opened before history was synced never gets a partial anchor.
export function entryIvFromFills(leg: PositionLeg, fills: EntryFill[]): number | null {
  const openSize = Math.abs(leg.size);
  if (!(openSize > 0)) return null;
  const openingDirection = leg.size > 0 ? 'buy' : 'sell';

  const opening = fills
    .filter((fill) => fill.direction === openingDirection && fill.amount > 0)
    .sort((a, b) => b.timestampMs - a.timestampMs);

  let covered = 0;
  let solvedAmount = 0;
  let weightedIv = 0;
  for (const fill of opening) {
    if (covered >= openSize - 1e-12) break;
    const lot = Math.min(fill.amount, openSize - covered);
    covered += lot;
    const iv = solveIv({
      price: fill.priceUsd,
      forward: fill.underlyingPriceUsd,
      strike: leg.strike,
      tYears: yearsToExpiryAt(leg.expiry, fill.timestampMs),
      right: leg.optionRight,
      seed: null,
    });
    if (iv == null) continue;
    solvedAmount += lot;
    weightedIv += iv * lot;
  }

  if (covered < openSize - 1e-9 || solvedAmount === 0) return null;
  return weightedIv / solvedAmount;
}
