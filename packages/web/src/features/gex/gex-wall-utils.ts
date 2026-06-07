import type { GexStrike } from '@shared/enriched';

// A strike whose |GEX| is below this ($M) can't be chosen as a wall, so a lone
// noise strike isn't mistaken for a dealer wall.
export const GEX_WALL_FLOOR_M = 1;

export interface GammaWalls {
  /** Largest positive-GEX strike above spot (long-gamma magnet → resistance). */
  callWall: number | null;
  /** Most negative-GEX strike below spot (short-gamma → support). */
  putWall: number | null;
  /** Price where cumulative signed GEX crosses zero (interpolated between strikes). */
  gammaFlip: number | null;
}

/**
 * Reduce signed per-strike GEX into the three Keltner-style levels. Each level
 * is null when its region is empty, below the floor, or (for the flip) the
 * cumulative GEX never crosses zero — callers must not draw a level that's null.
 */
export function computeGammaWalls(gex: readonly GexStrike[], spot: number | null): GammaWalls {
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

  return { callWall, putWall, gammaFlip: computeGammaFlip(gex) };
}

function computeGammaFlip(gex: readonly GexStrike[]): number | null {
  const sorted = [...gex].sort((a, b) => a.strike - b.strike);
  let prevStrike = 0;
  let prevCum = 0;
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += sorted[i]!.gexUsdMillions;
    if (i > 0 && ((prevCum < 0 && cum >= 0) || (prevCum > 0 && cum <= 0))) {
      const denom = Math.abs(prevCum) + Math.abs(cum);
      const lo = prevStrike;
      const hi = sorted[i]!.strike;
      return denom === 0 ? lo : lo + (hi - lo) * (Math.abs(prevCum) / denom);
    }
    prevCum = cum;
    prevStrike = sorted[i]!.strike;
  }
  return null;
}
