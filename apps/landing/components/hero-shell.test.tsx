import { render, screen } from '@testing-library/react';

import { HeroTerminalSection } from './HeroTerminalSection';
import { LandingHeader } from './LandingHeader';
import { TopTicker } from './TopTicker';

describe('hero shell', () => {
  it('renders live ticker items, navigation, and the app-like surface hero', () => {
    render(
      <>
        <TopTicker />
        <LandingHeader />
        <HeroTerminalSection />
      </>,
    );

    expect(screen.getAllByText(/Deribit · OKX · Binance · Bybit/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /request access/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /see the terminal/i })).toHaveAttribute(
      'href',
      '#showcase',
    );
    expect(screen.getByRole('link', { name: /^sign in$/i })).toHaveAttribute(
      'href',
      'https://app.oggregator.xyz',
    );
    expect(screen.getByRole('link', { name: /^terminal$/i })).toHaveAttribute(
      'href',
      '#showcase',
    );
    expect(screen.getByText(/cross-venue options terminal/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/interactive 3d volatility surface/i).length).toBeGreaterThan(
      0,
    );
  });

  it('renders the connected-venues proof row in the late hero beat', () => {
    render(<HeroTerminalSection />);

    for (const name of [
      'Deribit',
      'OKX',
      'Binance',
      'Bybit',
      'Thalex',
      'Derive',
      'Coincall',
      'Gate.io',
    ]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/not a screenshot/i)).toBeInTheDocument();
  });

  it('keeps the late hero beat invisible AND inert at load', () => {
    render(<HeroTerminalSection />);

    expect(screen.getAllByRole('link', { name: /request access/i })[0]).toBeVisible();
    expect(screen.getByText(/not a screenshot/i)).not.toBeVisible();
  });
});
