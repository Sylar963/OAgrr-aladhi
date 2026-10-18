import type { VenueId } from '../types/common.js';
import { type BookLookup, dealerGammaContracts } from './dealer-book.js';
import type { EnrichedStrike } from './enrichment.js';
import type { ComparisonRow } from './types.js';

/** Dollar gamma is quoted per 1% move in spot: γ × S² × 0.01. */
export const GEX_PER_PCT_MOVE = 0.01;

/** Net dealer GEX ($M per 1% move) if spot moved by `movePct` (0.05 = +5%), IV held per strike. */
export interface GexProfilePoint {
  movePct: number;
  gexUsdMillions: number;
}

const PROFILE_HALF_RANGE_STEPS = 40;
const PROFILE_STEP = 0.005;

/** Shared spot-move grid (±20% in 0.5% steps) so per-expiry profiles can be summed pointwise. */
export const GEX_PROFILE_MOVES: readonly number[] = Array.from(
  { length: PROFILE_HALF_RANGE_STEPS * 2 + 1 },
  (_, i) => Math.round((i - PROFILE_HALF_RANGE_STEPS) * PROFILE_STEP * 1e6) / 1e6,
);

const YEAR_MS = 365 * 86_400_000;
// Floors time to expiry so a contract minutes from settlement doesn't put an
// unbounded gamma spike into the profile.
const MIN_TTE_MS = 3_600_000;
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

export function bsGamma(forward: number, strike: number, iv: number, tYears: number): number {
  const volSqrtT = iv * Math.sqrt(tYears);
  const d1 = (Math.log(forward / strike) + 0.5 * volSqrtT * volSqrtT) / volSqrtT;
  return (INV_SQRT_2PI * Math.exp(-0.5 * d1 * d1)) / (forward * volSqrtT);
}

export function gexTimeToExpiryYears(expiryMs: number, nowMs: number): number {
  return Math.max(expiryMs - nowMs, MIN_TTE_MS) / YEAR_MS;
}

/**
 * Re-prices every contract's Black-Scholes gamma across the spot grid and sums the dealer
 * dollar gamma. Venues only report gamma at the current spot, and the gamma flip is the spot
 * level where this total changes sign, so it has to be recomputed rather than read off strikes.
 */
export function computeGexProfile(
  rows: ComparisonRow[],
  strikes: EnrichedStrike[],
  fallbackSpotPrice: number,
  expiryMs: number,
  bookLookup?: BookLookup,
  nowMs: number = Date.now(),
  options: { anchorToVenueGamma?: boolean } = {},
): GexProfilePoint[] {
  const totals = new Float64Array(GEX_PROFILE_MOVES.length);
  const tYears = gexTimeToExpiryYears(expiryMs, nowMs);
  const rowByStrike = new Map<number, ComparisonRow>(rows.map((r) => [r.strike, r]));

  for (const s of strikes) {
    const row = rowByStrike.get(s.strike);
    for (const right of ['call', 'put'] as const) {
      const side = s[right];
      for (const venueKey of Object.keys(side.venues) as VenueId[]) {
        const vq = side.venues[venueKey];
        if (vq === undefined || vq.openInterest === null) continue;
        if (vq.markIv == null || !(vq.markIv > 0)) continue;
        const original = row?.[right][venueKey];
        const venueSpot =
          original?.quote.indexPriceUsd ?? original?.quote.underlyingPriceUsd ?? fallbackSpotPrice;
        if (!(venueSpot > 0)) continue;
        const forward = original?.quote.underlyingPriceUsd ?? venueSpot;
        const pos = original && bookLookup ? bookLookup(venueKey, original.symbol) : undefined;
        const qty = dealerGammaContracts(pos, vq.openInterest, right);
        if (qty === 0) continue;
        let scale = (qty * (original?.contractSize ?? 1) * GEX_PER_PCT_MOVE) / 1_000_000;
        // Keeps the venue's own gamma at spot when its model differs from calendar-time
        // Black-Scholes (TastyTrade runs ~20% higher); the grid only borrows BS for the shape.
        if (options.anchorToVenueGamma && vq.gamma != null) {
          const atSpot = bsGamma(forward, s.strike, vq.markIv, tYears);
          if (atSpot > 0) scale *= vq.gamma / atSpot;
        }
        for (let i = 0; i < GEX_PROFILE_MOVES.length; i++) {
          const shift = 1 + GEX_PROFILE_MOVES[i]!;
          const spot = venueSpot * shift;
          totals[i]! += scale * bsGamma(forward * shift, s.strike, vq.markIv, tYears) * spot * spot;
        }
      }
    }
  }

  return GEX_PROFILE_MOVES.map((movePct, i) => ({ movePct, gexUsdMillions: totals[i]! }));
}

/** Sums per-expiry profiles built on GEX_PROFILE_MOVES. */
export function combineGexProfile(profiles: readonly (readonly GexProfilePoint[])[]): GexProfilePoint[] {
  const byMove = new Map<number, number>();
  for (const profile of profiles) {
    for (const p of profile) byMove.set(p.movePct, (byMove.get(p.movePct) ?? 0) + p.gexUsdMillions);
  }
  return [...byMove.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([movePct, gexUsdMillions]) => ({ movePct, gexUsdMillions }));
}
