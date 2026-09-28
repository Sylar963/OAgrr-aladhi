import { describe, expect, it } from 'vitest';
import type { PositionLeg } from '@oggregator/protocol';
import { portfolioToBuilderLegs, withPortfolioEntryPrice } from './portfolio-import';
import { pnlAtPrice } from './payoff';

const position: PositionLeg = {
  legId: 'short-call', underlying: 'BTC', expiry: '2026-10-30',
  strike: 100_000, optionRight: 'call', size: -0.2, entryPriceUsd: 2_000,
  entryIv: 0.5, realizedPnlUsd: 30, entryTs: 0, venueHint: 'derive', source: 'manual',
};

describe('portfolio import', () => {
  it('retains signed exposure, cost basis, venue and separate expiries', () => {
    const legs = portfolioToBuilderLegs([
      position,
      { ...position, legId: 'long-put', optionRight: 'put', size: 0.1, expiry: '2026-11-27' },
    ]);
    expect(legs[0]).toMatchObject({ direction: 'sell', quantity: 0.2, entryPrice: 2_000, venue: 'derive', iv: 0.5 });
    expect(legs[1]).toMatchObject({ direction: 'buy', quantity: 0.1, expiry: '2026-11-27', type: 'put' });
    expect(pnlAtPrice([legs[0]!], 110_000)).toBe(-1_600);
  });

  it('rejects mixed underlyings and empty books', () => {
    expect(portfolioToBuilderLegs([])).toEqual([]);
    expect(portfolioToBuilderLegs([position, { ...position, underlying: 'ETH' }])).toEqual([]);
  });

  it('keeps historical entry for analytics when live quotes change', () => {
    const imported = portfolioToBuilderLegs([position])[0]!;
    const live = { ...imported, entryPrice: 4_000, iv: 0.6 };
    expect(withPortfolioEntryPrice(live)).toMatchObject({ entryPrice: 2_000, iv: 0.6 });
    expect(pnlAtPrice([withPortfolioEntryPrice(live)], 110_000)).toBe(-1_600);
    expect(live.entryPrice).toBe(4_000);
    const { portfolioEntryPrice: _entry, ...ordinary } = live;
    expect(withPortfolioEntryPrice(ordinary).entryPrice).toBe(4_000);
  });
});
