import type { PositionLeg, VenueId } from '@oggregator/protocol';

export type ExpiryPositionDirection = 'long' | 'short' | 'mixed';

export interface ExpiryPositionBadge {
  direction: ExpiryPositionDirection;
  legs: readonly PositionLeg[];
  title: string;
}

function describeLeg(leg: PositionLeg, venue: VenueId): string {
  const sign = leg.size > 0 ? '+' : '−';
  const size = Number(Math.abs(leg.size).toPrecision(6));
  const right = leg.optionRight === 'call' ? 'C' : 'P';
  return `${venue} ${sign}${size} ${leg.strike}${right}`;
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
