import type { PublicPositionDto } from '@oggregator/protocol';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useSpots', () => ({
  useSpots: () => ({
    data: [{ symbol: 'BTCUSDT', lastPrice: 88_000, change24hPct: 0, updatedAt: 0 }],
  }),
}));

import OpenPositions from './OpenPositions';

function leg(strike: number, netQuantity: number, entry: number, mark: number): PublicPositionDto {
  return {
    underlying: 'BTC',
    expiry: '2099-10-30',
    strike,
    optionRight: 'put',
    netQuantity,
    avgEntryPriceUsd: entry,
    markPriceUsd: mark,
    unrealizedPnlUsd: netQuantity * (mark - entry),
  };
}

describe('OpenPositions', () => {
  afterEach(cleanup);

  it('draws each expiry as a strategy card with payoff and legs', () => {
    render(
      <OpenPositions positions={[leg(90_000, -0.01, 7025, 6800), leg(87_000, 0.01, 4870, 4700)]} />,
    );

    const card = screen.getByRole('article', {
      name: 'BTC 2099-10-30 positions',
    });
    expect(within(card).getByText('Bull Put Spread')).toBeDefined();
    expect(within(card).getByRole('img', { name: /Payoff at expiry/ })).toBeDefined();
    expect(within(card).getByText('+$21.55')).toBeDefined();
    expect(within(card).getByText('-$8.45')).toBeDefined();
    expect(within(card).getByText('Short')).toBeDefined();
    expect(within(card).getByText('Long')).toBeDefined();
    expect(within(card).getByText(/spot 88k/)).toBeDefined();
    expect(screen.getByText('1 long · 1 short')).toBeDefined();
  });
});
