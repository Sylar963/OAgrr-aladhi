import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SpreadDesk from './SpreadDesk';

const mocks = vi.hoisted(() => ({ chain: vi.fn(), scan: vi.fn() }));
vi.mock('@features/chain', () => ({
  useExpiries: () => ({
    data: {
      expiries: ['2026-09-22', '2026-09-25'],
      byVenue: [{ venue: 'thalex', expiries: ['2026-09-25'] }],
    },
  }),
  useChainQuery: mocks.chain,
}));
vi.mock('@features/portfolio', () => ({
  AlphaPortfolioContext: ({ venue }: { venue: string }) => <div>Portfolio source: {venue}</div>,
}));
vi.mock('./spread-scanner', async (original) => ({
  ...(await original<typeof import('./spread-scanner')>()),
  scanSpreads: mocks.scan,
}));

beforeEach(() => {
  localStorage.clear();
  mocks.chain.mockReturnValue({
    data: { stats: { indexPriceUsd: 80000 } },
    isError: false,
    isLoading: false,
  });
  mocks.scan.mockReturnValue([
    {
      venue: 'thalex',
      rejected: {},
      candidates: [
        {
          id: 'example',
          venue: 'thalex',
          expiry: '2026-09-25',
          kind: 'put-credit',
          direction: 'bullish',
          buyStrike: 80000,
          sellStrike: 80500,
          buySymbol: 'BTC-25SEP26-80000-P',
          sellSymbol: 'BTC-25SEP26-80500-P',
          quantity: 0.01,
          grossPremium: 1.8,
          entryFee: 0.12,
          legFees: { sell: 0.12, buy: 0.12 },
          costReserve: 0.25,
          maxProfit: 1.43,
          maxLoss: 3.57,
          riskPct: 0.33,
          breakeven: 80357,
          modelEdge: -0.5,
          probability: 0.6,
          model: 'market',
          status: 'no-edge',
          ageMs: 100,
          capacity: 1,
          roundTrip: -0.8,
        },
      ],
    },
  ]);
});
afterEach(cleanup);

describe('Alpha spread decision flow', () => {
  it('locks Thalex expiries and requires explicitly entered equity', () => {
    render(<SpreadDesk underlying="BTC" />);
    const expiry = screen.getByLabelText('Expiry') as HTMLSelectElement;
    expect([...expiry.options].map((o) => o.value)).toEqual(['2026-09-25']);
    expect(mocks.scan).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Account equity · USD'), { target: { value: '1080' } });
    expect(screen.getByText('$10.80')).toBeTruthy();
    expect(mocks.scan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        venues: ['thalex'],
        quantity: 0.01,
        equity: 1080,
        costReserve: 0.25,
      }),
    );
    expect(screen.getByText('No positive model edge within budget')).toBeTruthy();
    expect(screen.getByText('Portfolio source: thalex')).toBeTruthy();
  });
  it('opens the exact candidate with leg quantities and model labels', () => {
    render(<SpreadDesk underlying="BTC" />);
    fireEvent.change(screen.getByLabelText('Account equity · USD'), { target: { value: '1080' } });
    fireEvent.click(screen.getByRole('button', { name: /Put credit/ }));
    expect(screen.getByText('BTC-25SEP26-80000-P')).toBeTruthy();
    expect(screen.getByText('BTC-25SEP26-80500-P')).toBeTruthy();
    expect(screen.getByText('BUY 0.01 BTC')).toBeTruthy();
    expect(screen.getByText(/Probability is risk-neutral/)).toBeTruthy();
    expect(screen.getByText('Estimated entry fee')).toBeTruthy();
  });
  it('does not show cached candidates after a fetch error', () => {
    mocks.chain.mockReturnValue({ data: { stats: { indexPriceUsd: 80000 } }, isError: true });
    render(<SpreadDesk underlying="BTC" />);
    fireEvent.change(screen.getByLabelText('Account equity · USD'), { target: { value: '1080' } });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Put credit/ })).toBeNull();
  });
});
