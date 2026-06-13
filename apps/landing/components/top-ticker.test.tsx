import { fireEvent, render, screen } from '@testing-library/react';

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

  it('never renders hardcoded prices, sponsored slots, or internal jargon', () => {
    render(<TopTicker />);

    expect(screen.queryByText(/81\.3K/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sponsored/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/private feed/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Deribit · OKX · Binance · Bybit/).length).toBeGreaterThan(0);
  });

  it('exposes a pause control for the marquee', () => {
    render(<TopTicker />);

    const button = screen.getByRole('button', { name: /pause ticker/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
