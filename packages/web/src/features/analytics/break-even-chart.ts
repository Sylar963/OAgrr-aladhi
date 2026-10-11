import type { BreakEvenLine, BreakEvenPoint } from '@oggregator/protocol';

export interface ChartPoint {
  time: number;
  value: number;
}

const CALL_NEAR = [92, 242, 181];
const CALL_FAR = [24, 120, 88];
const PUT_NEAR = [255, 92, 122];
const PUT_FAR = [120, 32, 52];

function mix(from: number[], to: number[], t: number): string {
  const channel = (i: number) => Math.round(from[i]! + (to[i]! - from[i]!) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

export function lineKey(line: Pick<BreakEvenLine, 'right' | 'strike'>): string {
  return `${line.right}:${line.strike}`;
}

/** Brightest nearest the money, fading toward the wings, per side. */
export function lineColors(lines: readonly BreakEvenLine[], forward: number): Map<string, string> {
  const colors = new Map<string, string>();
  for (const right of ['call', 'put'] as const) {
    const side = lines
      .filter((line) => line.right === right)
      .sort((a, b) => Math.abs(a.strike - forward) - Math.abs(b.strike - forward));
    side.forEach((line, index) => {
      const t = side.length > 1 ? index / (side.length - 1) : 0;
      colors.set(
        lineKey(line),
        right === 'call' ? mix(CALL_NEAR, CALL_FAR, t) : mix(PUT_NEAR, PUT_FAR, t),
      );
    });
  }
  return colors;
}

/** Epoch-ms points to lightweight-charts seconds, ascending with no duplicate times. */
export function toChartPoints(points: readonly BreakEvenPoint[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const point of [...points].sort((a, b) => a.ts - b.ts)) {
    const time = Math.floor(point.ts / 1000);
    const last = out[out.length - 1];
    if (last != null && last.time === time) last.value = point.value;
    else out.push({ time, value: point.value });
  }
  return out;
}

/** Recorded path plus the live point, so it meets the projection without a gap. */
export function historyWithLive(line: BreakEvenLine): ChartPoint[] {
  const live = line.projection[0];
  return toChartPoints(live == null ? line.history : [...line.history, live]);
}

/** Flat spot line across the projection window, on the same time grid as the break-evens. */
export function spotProjection(
  lines: readonly BreakEvenLine[],
  spot: number,
  asOf: number,
): ChartPoint[] {
  const times = new Set<number>([asOf]);
  for (const point of lines[0]?.projection ?? []) times.add(point.ts);
  return toChartPoints([...times].map((ts) => ({ ts, value: spot })));
}

export function formatProb(value: number | null): string {
  if (value == null) return '–';
  const pct = value * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

/** Historical minus implied, in percentage points. */
export function probGap(line: Pick<BreakEvenLine, 'impliedProb' | 'historicalProb'>): number | null {
  return line.historicalProb == null ? null : (line.historicalProb - line.impliedProb) * 100;
}

export function defaultExpiry(
  expiries: ReadonlyArray<{ expiry: string; expiryTs: number | null }>,
  now: number,
  minDays = 7,
): string | null {
  const live = expiries.filter(
    (entry) => (entry.expiryTs ?? Date.parse(`${entry.expiry}T08:00:00Z`)) > now,
  );
  const preferred = live.find(
    (entry) =>
      (entry.expiryTs ?? Date.parse(`${entry.expiry}T08:00:00Z`)) - now >= minDays * 86_400_000,
  );
  return (preferred ?? live[0])?.expiry ?? null;
}

export function withAlpha(rgb: string, alpha: number): string {
  return rgb.replace(/^rgb\((.+)\)$/, `rgba($1, ${alpha})`);
}
