import type { GexStrike } from './enrichment.js';
import type { GexProfilePoint } from './gex-profile.js';

// A strike whose |GEX| is below this ($M per 1% move) can't be chosen as a wall,
// so a lone noise strike isn't mistaken for a dealer wall.
export const GEX_WALL_FLOOR_M = 0.01;

export interface GammaWalls {
  /** Largest positive-GEX strike above spot (long-gamma magnet → resistance). */
  callWall: number | null;
  /** Most negative-GEX strike below spot (short-gamma → support). */
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
 * points. The old cumulative-by-strike proxy could sit above spot while total GEX at spot was
 * positive; this answers "where do dealers switch from long to short gamma" directly.
 */
export function computeGammaFlip(
  profile: readonly GexProfilePoint[],
  spot: number,
): number | null {
  const sorted = [...profile].sort((a, b) => a.movePct - b.movePct);
  let best: number | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1]!;
    const hi = sorted[i]!;
    const a = lo.gexUsdMillions;
    const b = hi.gexUsdMillions;
    if (!((a < 0 && b >= 0) || (a > 0 && b <= 0))) continue;
    const move = lo.movePct + (hi.movePct - lo.movePct) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)));
    if (best === null || Math.abs(move) < Math.abs(best)) best = move;
  }
  return best === null ? null : spot * (1 + best);
}
