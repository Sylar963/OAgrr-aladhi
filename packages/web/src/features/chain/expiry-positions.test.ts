import { describe, expect, it } from 'vitest';
import type { PositionLeg } from '@oggregator/protocol';
import { summarizeExpiryPositions } from './expiry-positions.js';

function leg(overrides: Partial<PositionLeg>): PositionLeg {
  return {
    legId: 'l1',
    underlying: 'BTC',
    expiry: '2026-10-16',
    strike: 70_000,
    optionRight: 'call',
    size: 1,
    entryPriceUsd: 1_000,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: 0,
    venueHint: 'derive',
    source: 'derive',
    ...overrides,
  };
}

describe('summarizeExpiryPositions', () => {
  it('marks each expiry long, short or mixed from leg signs', () => {
    const badges = summarizeExpiryPositions(
      [
        {
          venue: 'derive',
          legs: [
            leg({ legId: 'a', expiry: '2026-10-16', size: 2 }),
            leg({ legId: 'b', expiry: '2026-10-30', size: -1, optionRight: 'put', strike: 60_000 }),
            leg({ legId: 'c', expiry: '2026-10-23', size: 1 }),
          ],
        },
        { venue: 'thalex', legs: [leg({ legId: 'd', expiry: '2026-10-23', size: -1, strike: 75_000 })] },
      ],
      'BTC',
    );

    expect(badges.get('2026-10-16')?.direction).toBe('long');
    expect(badges.get('2026-10-30')?.direction).toBe('short');
    expect(badges.get('2026-10-23')?.direction).toBe('mixed');
    expect(badges.get('2026-10-30')?.title).toBe('SHORT\nderive −1 60000P');
    expect(badges.get('2026-10-23')?.legs).toHaveLength(2);
  });

  it('ignores other underlyings and flat legs', () => {
    const badges = summarizeExpiryPositions(
      [{ venue: 'derive', legs: [leg({ underlying: 'ETH' }), leg({ legId: 'z', size: 0 })] }],
      'BTC',
    );
    expect(badges.size).toBe(0);
  });
});
