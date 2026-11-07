import type { LinearPosition, PublicPositionDto } from '@oggregator/protocol';
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

const PERP: LinearPosition = {
  instrumentName: 'BTC-PERPETUAL',
  underlying: 'BTC',
  kind: 'perpetual',
  expiry: null,
  sizeCoin: -0.1,
  entryPriceUsd: 90_000,
  markPriceUsd: 89_000,
  source: 'thalex',
};

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

  it('shows perps and dated futures with direction, coin size, prices and signed P&L', () => {
    render(
      <OpenPositions
        positions={[]}
        linearPositions={[
          PERP,
          {
            ...PERP,
            instrumentName: 'BTC-25DEC26',
            kind: 'future',
            expiry: '2026-12-25',
            sizeCoin: 0.2,
          },
        ]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Perpetuals & futures' });
    const short = within(table).getByText('BTC-PERPETUAL').closest('tr')!;
    expect(within(short).getByText('Short')).toBeDefined();
    expect(within(short).getByText('0.1 BTC')).toBeDefined();
    expect(within(short).getByText('$90,000')).toBeDefined();
    expect(within(short).getByText('$89,000')).toBeDefined();
    expect(within(short).getByText('+$100')).toBeDefined();
    const long = within(table).getByText('BTC-25DEC26').closest('tr')!;
    expect(within(long).getByText('Long')).toBeDefined();
    expect(within(long).getByText('-$200')).toBeDefined();
    expect(screen.getByText('-$100')).toBeDefined();
    expect(screen.queryByText('Net credit')).toBeNull();
    expect(screen.queryByRole('img', { name: /Payoff at expiry/ })).toBeNull();
  });

  it('combines option and perp P&L and leaves missing marks unknown', () => {
    const { rerender } = render(
      <OpenPositions positions={[leg(90_000, -0.01, 7025, 6800)]} linearPositions={[PERP]} />,
    );
    expect(screen.getByText('+$102')).toBeDefined();
    expect(screen.getByText('0 long · 2 short')).toBeDefined();

    rerender(<OpenPositions positions={[]} linearPositions={[{ ...PERP, markPriceUsd: null }]} />);
    const table = screen.getByRole('table', { name: 'Perpetuals & futures' });
    expect(within(table).getAllByText('–')).toHaveLength(2);
  });
});
