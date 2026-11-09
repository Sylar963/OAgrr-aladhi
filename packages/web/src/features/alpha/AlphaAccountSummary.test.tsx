import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlphaAccountSummary from './AlphaAccountSummary';

const mocks = vi.hoisted(() => ({ thalex: vi.fn(), paradex: vi.fn() }));
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready' }),
}));
vi.mock('../portfolio/hooks/queries', () => ({
  useThalexAccount: mocks.thalex,
  useParadexAccount: mocks.paradex,
}));
vi.mock('@features/portfolio', async () => ({
  ThalexAccountSummary: (await import('../portfolio/ThalexAccountSummary')).default,
  ParadexAccountSummary: (await import('../portfolio/ParadexAccountSummary')).default,
}));

const thalex = () => ({
  equityUsd: 2400,
  freeMarginUsd: -10,
  initialMarginUsd: 2450,
  updatedAt: Date.now(),
  environment: 'prod',
  unpricedAssets: [],
});

beforeEach(() => {
  mocks.thalex.mockReturnValue({ data: thalex(), isError: false, isPending: false });
  mocks.paradex.mockReturnValue({
    data: {
      equityUsd: 1190.69,
      freeCollateralUsd: 999.73,
      initialMarginUsd: 190.95,
      maintenanceMarginUsd: 190.95,
      settlementAsset: 'USDC',
      fetchedAt: Date.now(),
    },
    isError: false,
    isPending: false,
  });
});
afterEach(cleanup);

describe('Alpha account selection', () => {
  it('switches balances and copies only the selected equity on request', () => {
    const useEquity = vi.fn();
    render(<AlphaAccountSummary defaultVenue="paradex" onUseEquity={useEquity} />);
    expect(screen.getByText('$1,190.69')).toBeTruthy();
    expect(mocks.thalex).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'thalex' } });
    expect(screen.queryByText('$1,190.69')).toBeNull();
    expect(screen.getByText('$2,400.00')).toBeTruthy();
    expect(screen.getByText('-$10.00')).toBeTruthy();
    expect(screen.getByText('Mainnet')).toBeTruthy();
    expect(screen.getByText('Maintenance margin is not reported by Thalex.')).toBeTruthy();
    expect(useEquity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use equity for this plan' }));
    expect(useEquity).toHaveBeenLastCalledWith(2400);
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'paradex' } });
    expect(useEquity).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Use equity for this plan' }));
    expect(useEquity).toHaveBeenLastCalledWith(1190.69);
  });

  it('identifies testnet and displays missing margin as unavailable', () => {
    mocks.thalex.mockReturnValue({
      data: { ...thalex(), environment: 'test', freeMarginUsd: null, initialMarginUsd: null },
      isError: false,
    });
    render(<AlphaAccountSummary defaultVenue="thalex" />);
    expect(screen.getByText('Testnet')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });

  it.each([
    { data: { ...thalex(), updatedAt: Date.now() - 60_000 }, isError: false },
    { data: thalex(), isError: true },
    { data: { ...thalex(), equityUsd: 0 }, isError: false },
    { data: { ...thalex(), unpricedAssets: ['XYZ'] }, isError: false },
  ])('disables copying stale, failed, zero or incomplete equity', (query) => {
    mocks.thalex.mockReturnValue(query);
    const useEquity = vi.fn();
    render(<AlphaAccountSummary defaultVenue="thalex" onUseEquity={useEquity} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use equity for this plan' }));
    expect(useEquity).not.toHaveBeenCalled();
  });

  it('does not display the previous venue balance while the selected account loads', () => {
    mocks.thalex.mockReturnValue({ data: undefined, isError: false, isPending: true });
    render(<AlphaAccountSummary defaultVenue="paradex" onUseEquity={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'thalex' } });
    expect(screen.getByText('Loading Thalex equity…')).toBeTruthy();
    expect(screen.queryByText('$1,190.69')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use equity for this plan' })).toBeNull();
  });

  it('keeps Paradex selectable when Thalex is disconnected', () => {
    mocks.thalex.mockReturnValue({ data: undefined, isError: true, isPending: false });
    render(<AlphaAccountSummary defaultVenue="thalex" />);
    expect(screen.getByText(/Thalex equity unavailable/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'paradex' } });
    expect(screen.getByText('$1,190.69')).toBeTruthy();
  });
});
