import type { PositionLeg, VenueId } from '@oggregator/protocol';

export type ExpiryPositionDirection = 'long' | 'short' | 'mixed';

export interface ExpiryPositionBadge {
  direction: ExpiryPositionDirection;
  legs: readonly PositionLeg[];
  title: string;
}

function describeLeg(leg: PositionLeg, venue: VenueId): string {
  const right = leg.optionRight === 'call' ? 'C' : 'P';
  return `${venue} ${formatSignedSize(leg.size)} ${leg.strike}${right}`;
}

// Mixed means the expiry holds both long and short legs (spreads, condors);
// labelling that "long" or "short" would misstate the exposure.
export function summarizeExpiryPositions(
  byVenue: ReadonlyArray<{ venue: VenueId; legs: readonly PositionLeg[] }>,
  underlying: string,
): Map<string, ExpiryPositionBadge> {
  const grouped = new Map<string, { legs: PositionLeg[]; lines: string[] }>();
  for (const { venue, legs } of byVenue) {
    for (const leg of legs) {
      if (leg.underlying !== underlying || leg.size === 0) continue;
      const bucket = grouped.get(leg.expiry) ?? { legs: [], lines: [] };
      bucket.legs.push(leg);
      bucket.lines.push(describeLeg(leg, venue));
      grouped.set(leg.expiry, bucket);
    }
  }

  const out = new Map<string, ExpiryPositionBadge>();
  for (const [expiry, { legs, lines }] of grouped) {
    const hasLong = legs.some((l) => l.size > 0);
    const hasShort = legs.some((l) => l.size < 0);
    const direction: ExpiryPositionDirection = hasLong && hasShort ? 'mixed' : hasLong ? 'long' : 'short';
    out.set(expiry, { direction, legs, title: `${direction.toUpperCase()}\n${lines.join('\n')}` });
  }
  return out;
}

export interface StrikePosition {
  size: number;
  title: string;
}

export function strikePositionKey(strike: number, right: 'call' | 'put'): string {
  return `${strike}:${right}`;
}

export function formatSignedSize(size: number): string {
  const abs = Number(Math.abs(size).toPrecision(6));
  return `${size > 0 ? '+' : '−'}${abs}`;
}

export function summarizeStrikePositions(
  legs: readonly PositionLeg[],
): Map<string, StrikePosition> {
  const grouped = new Map<string, { size: number; lines: string[] }>();
  for (const leg of legs) {
    if (leg.size === 0) continue;
    const key = strikePositionKey(leg.strike, leg.optionRight);
    const bucket = grouped.get(key) ?? { size: 0, lines: [] };
    bucket.size += leg.size;
    bucket.lines.push(
      `${leg.venueHint ?? leg.source} ${formatSignedSize(leg.size)} @ $${leg.entryPriceUsd.toFixed(2)}`,
    );
    grouped.set(key, bucket);
  }
  const out = new Map<string, StrikePosition>();
  for (const [key, { size, lines }] of grouped) {
    if (Math.abs(size) < 1e-9) continue;
    out.set(key, { size, title: lines.join('\n') });
  }
  return out;
}
