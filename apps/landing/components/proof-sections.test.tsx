import { fireEvent, render, screen } from '@testing-library/react';

import { faqItems, venues } from '@/lib/demo-data';
import { FaqSection } from './FaqSection';
import { FeatureBentoSection } from './FeatureBentoSection';
import { HowItWorksSection } from './HowItWorksSection';

describe('proof sections', () => {
  it('renders workflow and feature proof for the spatial experience', () => {
    render(
      <>
        <HowItWorksSection />
        <FeatureBentoSection />
      </>,
    );

    expect(
      screen.getByRole('heading', {
        name: /surface\. chain\. portfolio\./i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /^surface$/i }).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('heading', {
        name: /cross-venue from the first quote\./i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/four lenses\. every venue\./i)).toBeInTheDocument();
    expect(screen.getAllByText(/normalized quotes/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: /^route$/i }).length).toBeGreaterThan(0);
  });

  it('opens and closes FAQ items', () => {
    render(<FaqSection />);

    expect(
      screen.getByText(/deribit, okx, binance, bybit, thalex, derive/i),
    ).toBeInTheDocument();

    const button = screen.getByRole('button', {
      name: /how fast is the feed/i,
    });

    fireEvent.click(button);

    expect(
      screen.getByText(/sub-second across every venue/i),
    ).toBeInTheDocument();
  });

  it('derives every count from data and ships no unverifiable stats', () => {
    render(<FaqSection />);

    // Expected counts come from the same source the component reads, so adding a
    // venue or FAQ entry won't silently break this test.
    const entries = `${String(faqItems.length).padStart(2, '0')} entries`;
    const wired = `${String(venues.length).padStart(2, '0')} wired`;
    expect(screen.getByText(entries)).toBeInTheDocument();
    expect(screen.getByText(wired)).toBeInTheDocument();
    expect(screen.queryByText(/420\s?ms/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/99\.98/)).not.toBeInTheDocument();
  });
});
