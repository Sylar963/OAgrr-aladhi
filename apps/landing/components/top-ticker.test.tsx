import { render, screen } from '@testing-library/react';

import { TopTicker } from './TopTicker';

describe('TopTicker', () => {
  it('renders live BTC/ETH spot when provided', () => {
    render(
      <TopTicker
        spots={{
          BTC: { priceLabel: '$80.0K', changeLabel: '+3.0%' },
          ETH: { priceLabel: '$2.0K', changeLabel: '-1.0%' },
        }}
      />,
    );

    expect(screen.getAllByText('BTC $80.0K +3.0%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ETH $2.0K -1.0%').length).toBeGreaterThan(0);
  });

  it('falls back to demo spot strings without props', () => {
    render(<TopTicker />);
    expect(screen.getAllByText('BTC $81.3K +2.5%').length).toBeGreaterThan(0);
  });
});
