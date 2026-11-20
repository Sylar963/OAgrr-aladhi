export interface SkewPricePoint {
  time: number;
  value: number | null;
}

export function chartPath(
  points: readonly SkewPricePoint[],
  toX: (time: number) => number,
  toY: (value: number) => number,
  maxGapSec: number,
): string {
  let path = '';
  let previous: number | null = null;
  for (const point of points) {
    if (point.value == null || !Number.isFinite(point.value)) {
      previous = null;
      continue;
    }
    const connected = previous != null && point.time - previous <= maxGapSec;
    path += `${connected ? 'L' : 'M'}${toX(point.time).toFixed(1)},${toY(point.value).toFixed(1)}`;
    previous = point.time;
  }
  return path;
}

export function nearestPoint(
  points: readonly SkewPricePoint[],
  time: number,
  maxDistanceSec: number,
): SkewPricePoint | null {
  let nearest: SkewPricePoint | null = null;
  for (const point of points) {
    if (point.value == null || !Number.isFinite(point.value)) continue;
    const distance = Math.abs(point.time - time);
    if (distance <= maxDistanceSec && (!nearest || distance < Math.abs(nearest.time - time))) {
      nearest = point;
    }
  }
  return nearest;
}

export function chartRange(points: readonly SkewPricePoint[]): [number, number] | null {
  const values = points.flatMap((point) =>
    point.value != null && Number.isFinite(point.value) ? [point.value] : [],
  );
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = (max - min || Math.abs(max) * 0.01 || 1) * 0.08;
  return [min - padding, max + padding];
}
