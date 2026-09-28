import type { BreakEvenIvRow, PositionLeg } from '@oggregator/protocol';
import type { Leg } from './payoff';

export function portfolioToBuilderLegs(
  positions: PositionLeg[],
  marks: BreakEvenIvRow[] = [],
): Leg[] {
  if (new Set(positions.map((position) => position.underlying)).size !== 1) return [];
  return positions.map((position) => ({
    id: `portfolio-${position.legId}`,
    type: position.optionRight,
    direction: position.size > 0 ? 'buy' : 'sell',
    strike: position.strike,
    expiry: position.expiry,
    quantity: Math.abs(position.size),
    entryPrice: position.entryPriceUsd,
    portfolioEntryPrice: position.entryPriceUsd,
    venue: position.venueHint ?? '',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: marks.find((mark) => mark.legId === position.legId)?.currentIv ?? position.entryIv,
  }));
}

export function withPortfolioEntryPrice(leg: Leg): Leg {
  return leg.portfolioEntryPrice == null ? leg : { ...leg, entryPrice: leg.portfolioEntryPrice };
}
