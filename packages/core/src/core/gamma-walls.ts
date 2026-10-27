import type { GexStrike } from './enrichment.js';
import type { GexProfilePoint } from './gex-profile.js';

// A strike whose |GEX| is below this ($M per 1% move) can't be chosen as a wall,
// so a lone noise strike isn't mistaken for a dealer wall.
export const GEX_WALL_FLOOR_M = 0.01;

export interface GammaWalls {
  // Historical field names are retained for stored snapshots; these are signed net-GEX zones.
  callWall: number | null;
  putWall: number | null;
  /** Spot level nearest the current spot where total dealer GEX changes sign. */
  gammaFlip: number | null;
}

/**
 * Mirrors packages/web/src/features/gex/gex-wall-utils.ts so recorded wall history matches
 * the levels the dashboard draws. Each level is null when its region is empty, below the
 * floor, or (for the flip) there is no profile or total GEX keeps one sign across it.
 */
export function computeGammaWalls(
  gex: readonly GexStrike[],
  spot: number | null,
  profile?: readonly GexProfilePoint[],
): GammaWalls {
  if (spot == null || !Number.isFinite(spot) || gex.length === 0) {
    return { callWall: null, putWall: null, gammaFlip: null };
  }

  let callWall: number | null = null;
  let callMax = GEX_WALL_FLOOR_M;
  let putWall: number | null = null;
  let putMin = -GEX_WALL_FLOOR_M;

  for (const g of gex) {
    if (g.strike > spot && g.gexUsdMillions > callMax) {
      callMax = g.gexUsdMillions;
      callWall = g.strike;
    } else if (g.strike < spot && g.gexUsdMillions < putMin) {
      putMin = g.gexUsdMillions;
      putWall = g.strike;
    }
  }

  return {
    callWall,
    putWall,
    gammaFlip: profile && profile.length > 1 ? computeGammaFlip(profile, spot) : null,
  };
}

/**
 * Zero crossing of total dealer GEX across hypothetical spot levels, interpolated between grid
 * points. Requires both signs: a zero-valued tail or a touch of zero is not a regime change.
 */
export function computeGammaFlip(
  profile: readonly GexProfilePoint[],
  spot: number,
): number | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  const sorted = [...profile].sort((a, b) => a.movePct - b.movePct);
  let best: number | null = null;
  let previous = -1;
  for (let i = 0; i < sorted.length; i++) {
    const hi = sorted[i]!;
    if (hi.gexUsdMillions === 0) continue;
    const loIndex = previous;
    previous = i;
    if (loIndex < 0) continue;
    const lo = sorted[loIndex]!;
    const a = lo.gexUsdMillions;
    const b = hi.gexUsdMillions;
    if (!((a < 0 && b > 0) || (a > 0 && b < 0))) continue;
    const move = i > loIndex + 1
      ? Math.max(sorted[loIndex + 1]!.movePct, Math.min(0, sorted[i - 1]!.movePct))
      : lo.movePct + (hi.movePct - lo.movePct) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)));
    if (best === null || Math.abs(move) < Math.abs(best)) best = move;
  }
  return best === null ? null : spot * (1 + best);
}
