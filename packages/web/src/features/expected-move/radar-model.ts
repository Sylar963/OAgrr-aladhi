import type { ExpectedMoveSession, ExpectedStraddleResponse } from '@oggregator/protocol';

export interface RadarCandle {
  timestamp: number;
  open: number;
  close: number;
}

export interface RadarPoint {
  time: number;
  price: number;
  gap: boolean;
}

export interface RadarCone {
  start: number;
  end: number;
  center: number;
  scale: number;
  clockMs: number;
  shape: 'normal' | 'lognormal';
}

export interface RadarEvent {
  time: number;
  price: number;
  level: 1 | 2;
  kind: 'cross' | 'return';
  direction: 'up' | 'down';
}

const YEAR_MS = 365 * 86_400_000;

export function openingCone(session: ExpectedMoveSession): RadarCone | null {
  return session.expectedUsd != null && session.expectedUsd > 0
    ? {
        start: session.startMs,
        end: session.endMs,
        center: session.open,
        scale: session.expectedUsd,
        clockMs: session.endMs - session.startMs,
        shape: 'normal',
      }
    : null;
}

export function coneBounds(cone: RadarCone, time: number, level = 1): [number, number] | null {
  if (time < cone.start || time > cone.end || cone.clockMs <= 0) return null;
  const width = level * cone.scale * Math.sqrt((time - cone.start) / cone.clockMs);
  return cone.shape === 'normal'
    ? [cone.center - width, cone.center + width]
    : [cone.center * Math.exp(-width), cone.center * Math.exp(width)];
}

export function expiryCone(
  quote: ExpectedStraddleResponse,
  reference: 'surface' | 'index',
): RadarCone | null {
  const iv = reference === 'surface' ? quote.surfaceIv : quote.indexIv;
  if (
    quote.quoteAsOfMs == null ||
    quote.expiryTs == null ||
    quote.expiryTs <= quote.quoteAsOfMs ||
    quote.forward == null ||
    quote.forward <= 0 ||
    iv == null ||
    iv <= 0
  )
    return null;
  return {
    start: quote.quoteAsOfMs,
    end: quote.expiryTs,
    center: quote.forward,
    scale: iv,
    clockMs: YEAR_MS,
    shape: 'lognormal',
  };
}

export function liveCone(
  session: ExpectedMoveSession,
  point: RadarPoint,
  iv: number | null,
  periods: 252 | 365,
): RadarCone | null {
  if (iv == null || iv <= 0 || point.time >= session.endMs) return null;
  return {
    start: point.time,
    end: session.endMs,
    center: point.price,
    scale: (point.price * iv) / Math.sqrt(periods),
    clockMs: session.endMs - session.startMs,
    shape: 'normal',
  };
}

export function radarRatios(session: ExpectedMoveSession, point: RadarPoint) {
  const signed = point.price / session.open - 1;
  const fraction = Math.max(
    0,
    Math.min(1, (point.time - session.startMs) / (session.endMs - session.startMs)),
  );
  const daily =
    session.expectedFraction != null && session.expectedFraction > 0
      ? Math.abs(signed) / session.expectedFraction
      : null;
  return {
    signed,
    daily,
    pace:
      daily != null && point.time - session.startMs >= 60_000 && fraction > 0
        ? daily / Math.sqrt(fraction)
        : null,
  };
}

export function buildRadarTrail(
  session: ExpectedMoveSession,
  candles: readonly RadarCandle[],
  resolutionMs: number,
  nowMs: number,
): RadarPoint[] {
  const limit = Math.min(nowMs, session.endMs);
  const byTime = new Map<number, number>();
  byTime.set(session.startMs, session.open);
  for (const bar of candles) {
    const closeAt = bar.timestamp + resolutionMs;
    if (
      closeAt > session.startMs &&
      closeAt <= limit &&
      closeAt <= session.priceAsOfMs &&
      Number.isFinite(bar.close) &&
      bar.close > 0
    )
      byTime.set(closeAt, bar.close);
  }
  if (session.priceAsOfMs >= session.startMs && session.priceAsOfMs <= limit) {
    byTime.set(session.priceAsOfMs, session.last);
  }
  const points = [...byTime].sort(([a], [b]) => a - b);
  return points.map(([time, price], i) => ({
    time,
    price,
    gap: i > 0 && time - points[i - 1]![0] > resolutionMs * 1.75,
  }));
}

export function radarEvents(
  points: readonly RadarPoint[],
  cone: RadarCone | null,
  twoSigma: boolean,
): RadarEvent[] {
  if (cone == null) return [];
  const events: RadarEvent[] = [];
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1]!;
    const current = points[i]!;
    if (current.gap || before.time <= cone.start || current.time > cone.end) continue;
    for (const level of (twoSigma ? [1, 2] : [1]) as Array<1 | 2>) {
      const a = coneBounds(cone, before.time, level);
      const b = coneBounds(cone, current.time, level);
      if (!a || !b) continue;
      const wasOutside = before.price < a[0] || before.price > a[1];
      const outside = current.price < b[0] || current.price > b[1];
      if (wasOutside !== outside)
        events.push({
          time: current.time,
          price: current.price,
          level,
          kind: outside ? 'cross' : 'return',
          direction: current.price >= cone.center ? 'up' : 'down',
        });
    }
  }
  return events;
}

export function straddleLevels(
  quote: ExpectedStraddleResponse,
): Array<{ kind: 'buy' | 'sell'; lower: number; upper: number }> {
  if (quote.strike == null) return [];
  const levels: Array<{ kind: 'buy' | 'sell'; lower: number; upper: number }> = [];
  if (quote.ask != null)
    levels.push({ kind: 'buy', lower: quote.strike - quote.ask, upper: quote.strike + quote.ask });
  if (quote.bid != null)
    levels.push({ kind: 'sell', lower: quote.strike - quote.bid, upper: quote.strike + quote.bid });
  return levels;
}
