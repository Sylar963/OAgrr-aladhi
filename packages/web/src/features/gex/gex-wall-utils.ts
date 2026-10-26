import type { GexProfilePoint, GexStrike } from '@shared/enriched';

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
 * Reduce signed per-strike GEX into the three Keltner-style levels. Mirrors
 * packages/core/src/core/gamma-walls.ts. Each level is null when its region is
 * empty, below the floor, or (for the flip) there is no profile or total GEX
 * keeps one sign across it — callers must not draw a level that's null.
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

/** Zero crossing of total dealer GEX across the spot grid nearest the current spot. */
export function computeGammaFlip(profile: readonly GexProfilePoint[], spot: number): number | null {
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

/** Pointwise sum of per-expiry profiles (all built on the same server-side grid). */
export function sumGexProfiles(
  profiles: readonly (readonly GexProfilePoint[] | undefined)[],
): GexProfilePoint[] {
  const byMove = new Map<number, number>();
  for (const profile of profiles) {
    for (const p of profile ?? []) {
      byMove.set(p.movePct, (byMove.get(p.movePct) ?? 0) + p.gexUsdMillions);
    }
  }
  return [...byMove.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([movePct, gexUsdMillions]) => ({ movePct, gexUsdMillions }));
}

/** Total dealer GEX at the current spot (the profile's 0% point). */
export function gexAtSpot(profile: readonly GexProfilePoint[] | undefined): number | null {
  const point = profile?.find((p) => p.movePct === 0);
  return point ? point.gexUsdMillions : null;
}

/** |GEX|-weighted share of gross gamma whose dealer sign came from observed flow. */
export function flowAttributedShare(gex: readonly GexStrike[]): number | null {
  let gross = 0;
  let flow = 0;
  let seen = false;
  for (const g of gex) {
    if (g.flowShare === undefined) continue;
    seen = true;
    const abs = Math.abs(g.gexUsdMillions);
    gross += abs;
    flow += abs * g.flowShare;
  }
  return seen && gross > 0 ? flow / gross : null;
}

/** "$M per 1%" values span 1e-4 (small alts) to 1e2+ (BTC), so precision scales with size. */
export function formatGexM(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : abs >= 0.01 ? 2 : 4;
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}M`;
}
