import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlphaView from './AlphaView';
import type { SpreadCandidate } from './spread-scanner';

const mocks = vi.hoisted(() => ({ chain: vi.fn(), scan: vi.fn() }));
vi.mock('@features/chain', () => ({
  useExpiries: () => ({ data: { expiries: ['2026-09-25'] } }),
  usePrefetchChain: () => vi.fn(),
  useChainQuery: mocks.chain,
  ExpiryBar: () => <div>Original expiry bar</div>,
}));
vi.mock('@features/portfolio', () => ({
  AlphaPortfolioContext: ({ venue }: { venue: string }) => <div>Portfolio exposure: {venue}</div>,
}));
vi.mock('@components/layout/palette-context', () => ({ useOpenPalette: () => vi.fn() }));
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('./useAlphaMarketContext', () => ({
  useAlphaMarketContext: () => ({ data: null, isLoading: false }),
}));
vi.mock('./useRegimeQuery', () => ({ useRegimeQuery: () => ({ data: null }) }));
vi.mock('./useVerticalSpreadAnalysis', () => ({
  useVerticalSpreadAnalysis: () => ({
    spot: 80000,
    forward: 80000,
    T: 7 / 365,
    smile: null,
    analysis: { short: { candidates: [], best: null }, long: { candidates: [], best: null } },
  }),
}));
vi.mock('./VolSmileInset', () => ({ default: () => <div>Original volatility smile</div> }));
vi.mock('./LottoScannerPanel', () => ({ default: () => <div>Original long-call scanner</div> }));
vi.mock('./spread-scanner', async (original) => ({
  ...(await original<typeof import('./spread-scanner')>()),
  scanSpreads: mocks.scan,
}));

const candidate: SpreadCandidate = {
  id: 'credit',
  venue: 'thalex',
  expiry: '2026-09-25',
  kind: 'call-credit',
  direction: 'bearish',
  sellStrike: 80000,
  buyStrike: 81000,
  buySymbol: 'BUY',
  sellSymbol: 'SELL',
  quantity: 0.01,
  grossPremium: 4,
  entryFee: 0.12,
  costReserve: 0.25,
  maxProfit: 3.63,
  maxLoss: 6.37,
  riskPct: 0.59,
  breakeven: 80363,
  modelEdge: -0.5,
  probability: 0.6,
  model: 'market',
  status: 'no-edge',
  ageMs: 1,
  capacity: 1,
  roundTrip: -1,
};

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    underlying: 'BTC',
    expiry: '2026-09-25',
    activeVenues: ['thalex', 'okx'],
  });
  mocks.chain.mockReturnValue({
    data: {
      underlying: 'BTC',
      expiry: '2026-09-25',
      stats: { atmStrike: 80000 },
      strikes: [{ strike: 80000 }, { strike: 81000 }],
    },
    isLoading: false,
    error: null,
  });
  mocks.scan.mockReturnValue([
    {
      venue: 'thalex',
      rejected: {},
      candidates: [
        candidate,
        {
          ...candidate,
          id: 'debit',
          kind: 'call-debit',
          direction: 'bullish',
          sellStrike: 81000,
          buyStrike: 80000,
          grossPremium: -4,
        },
      ],
    },
    { venue: 'okx', rejected: { 'Unknown entry fees': 2 }, candidates: [] },
  ]);
  mocks.scan.mockClear();
});
afterEach(cleanup);

describe('surgical Alpha enhancements', () => {
  it('retains original tools and adds debit tabs without mounting the replacement desk', () => {
    render(<AlphaView />);
    const tabs = within(screen.getByRole('tablist', { name: 'Alpha strategy' }));
    for (const name of ['Call Credit', 'Put Credit', 'Call Debit', 'Put Debit', 'Long Call'])
      expect(tabs.getByRole('tab', { name })).toBeTruthy();
    expect(screen.getAllByRole('tab', { name: 'Call Credit' })).toHaveLength(1);
    expect(screen.getAllByRole('tab', { name: 'Put Credit' })).toHaveLength(1);
    expect(screen.getByText('Original expiry bar')).toBeTruthy();
    expect(screen.getByText('Original volatility smile')).toBeTruthy();
    expect(screen.getByText('Short leg · SELL')).toBeTruthy();
    expect(screen.getByText('Long leg · BUY')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Spread scanner' })).toBeNull();
    fireEvent.click(tabs.getByRole('tab', { name: 'Long Call' }));
    expect(screen.getByText('Original long-call scanner')).toBeTruthy();
  });
  it('requires manual equity, uses actual quantity and fees, and shows per-venue coverage', () => {
    render(<AlphaView />);
    expect(mocks.scan).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Account equity · USD'), { target: { value: '1080' } });
    expect(mocks.scan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        equity: 1080,
        quantity: 0.01,
        venues: ['okx', 'thalex'],
        costReserve: 0.25,
      }),
    );
    expect(screen.getByText('Risk $6.37')).toBeTruthy();
    expect(screen.getByText('0.59%')).toBeTruthy();
    expect(screen.getAllByText('Fee data missing').length).toBeGreaterThan(0);
    expect(screen.getByText('Portfolio exposure: thalex')).toBeTruthy();
    expect(screen.getByText('Model probability')).toBeTruthy();
    expect(screen.getByText('Expiry payoff')).toBeTruthy();
    expect(screen.getByLabelText(/Risk budget used/)).toBeTruthy();
    expect(screen.queryByText(/Sinclair|Bennett|Casanovas/)).toBeNull();
  });
  it('keeps debit selection in the existing builder', () => {
    render(<AlphaView />);
    fireEvent.change(screen.getByLabelText('Account equity · USD'), { target: { value: '1080' } });
    fireEvent.click(
      within(screen.getByRole('tablist', { name: 'Alpha strategy' })).getByRole('tab', {
        name: 'Call Debit',
      }),
    );
    expect(screen.getByText('Cash paid')).toBeTruthy();
    expect(screen.getByText('Original volatility smile')).toBeTruthy();
    expect(screen.getByText(/Bullish. Buy lower call/)).toBeTruthy();
  });
  it('does not present cached candidates after a chain error', () => {
    mocks.chain.mockReturnValue({ ...mocks.chain(), error: new Error('offline') });
    render(<AlphaView />);
    fireEvent.change(screen.getByLabelText('Account equity · USD'), { target: { value: '1080' } });
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(screen.queryByText('$6.37')).toBeNull();
    expect(screen.getByText(/Cached quotes are not used/)).toBeTruthy();
  });
});
