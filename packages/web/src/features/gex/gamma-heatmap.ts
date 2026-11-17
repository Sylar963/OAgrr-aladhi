import type { GexProfilePoint } from '@shared/enriched';

export interface GammaHeatmapPoint {
  price: number;
  gexUsdMillions: number;
}

export interface GammaHeatmap {
  points: readonly GammaHeatmapPoint[];
  maxMagnitude: number;
  opacity: number;
  profileOutline?: boolean;
}

export interface GammaProfileVertex {
  y: number;
  gexUsdMillions: number;
}

export function visibleGammaProfile(
  points: readonly GammaHeatmapPoint[],
  priceToY: (price: number) => number | null,
  height: number,
): GammaProfileVertex[] {
  const vertices: GammaProfileVertex[] = [];
  const append = (vertex: GammaProfileVertex) => {
    if (vertices.at(-1)?.y !== vertex.y) vertices.push(vertex);
  };
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1]!;
    const hi = points[i]!;
    const y0 = priceToY(lo.price);
    const y1 = priceToY(hi.price);
    if (y0 == null || y1 == null || !Number.isFinite(y0) || !Number.isFinite(y1) || y0 === y1)
      continue;
    const start = Math.max(0, Math.min((0 - y0) / (y1 - y0), (height - y0) / (y1 - y0)));
    const end = Math.min(1, Math.max((0 - y0) / (y1 - y0), (height - y0) / (y1 - y0)));
    if (start > end) continue;
    const at = (weight: number): GammaProfileVertex => ({
      y: Math.max(0, Math.min(height, y0 + weight * (y1 - y0))),
      gexUsdMillions: lo.gexUsdMillions + weight * (hi.gexUsdMillions - lo.gexUsdMillions),
    });
    append(at(start));
    if (lo.gexUsdMillions * hi.gexUsdMillions < 0) {
      const zero =
        Math.abs(lo.gexUsdMillions) / (Math.abs(lo.gexUsdMillions) + Math.abs(hi.gexUsdMillions));
      if (zero > start && zero < end) append({ ...at(zero), gexUsdMillions: 0 });
    }
    append(at(end));
  }
  return vertices;
}

export function gammaHeatmap(
  profile: readonly GexProfilePoint[] | undefined,
  spot: number | null,
): Omit<GammaHeatmap, 'opacity'> {
  const empty = { points: [], maxMagnitude: 0 };
  if (!profile || profile.length < 2 || spot == null || !Number.isFinite(spot) || spot <= 0)
    return empty;
  const points = profile
    .map((point) => ({
      price: spot * (1 + point.movePct),
      gexUsdMillions: point.gexUsdMillions,
    }))
    .sort((a, b) => a.price - b.price);
  if (
    points.some(
      (point, i) =>
        !Number.isFinite(point.price) ||
        point.price <= 0 ||
        !Number.isFinite(point.gexUsdMillions) ||
        (i > 0 && point.price === points[i - 1]!.price),
    )
  )
    return empty;
  return {
    points,
    maxMagnitude: Math.max(...points.map((point) => Math.abs(point.gexUsdMillions))),
  };
}

export function gammaAtPrice(points: readonly GammaHeatmapPoint[], price: number): number | null {
  if (
    !Number.isFinite(price) ||
    points.length < 2 ||
    price < points[0]!.price ||
    price > points[points.length - 1]!.price
  )
    return null;
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1]!;
    const hi = points[i]!;
    if (price <= hi.price) {
      const weight = (price - lo.price) / (hi.price - lo.price);
      return lo.gexUsdMillions + weight * (hi.gexUsdMillions - lo.gexUsdMillions);
    }
  }
  return null;
}

export function gammaHeatColor(value: number, maximum: number, opacity: number): string {
  const strength = maximum > 0 ? Math.min(1, Math.abs(value) / maximum) : 0;
  const alpha = strength * Math.max(0, Math.min(1, opacity));
  return value < 0 ? `rgba(239, 70, 101, ${alpha})` : `rgba(0, 233, 151, ${alpha})`;
}

export function gammaContours(points: readonly GammaHeatmapPoint[], value: number): number[] {
  const prices = new Set<number>();
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1]!;
    const hi = points[i]!;
    const a = lo.gexUsdMillions;
    const b = hi.gexUsdMillions;
    if (a === b) continue;
    const weight = (value - a) / (b - a);
    if (weight >= 0 && weight <= 1) prices.add(lo.price + weight * (hi.price - lo.price));
  }
  return [...prices];
}
