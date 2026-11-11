import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ParadexAccountSummary from './ParadexAccountSummary';

const mocks = vi.hoisted(() => ({ account: vi.fn() }));
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready' }),
}));
vi.mock('./hooks/queries', () => ({ useParadexAccount: mocks.account }));
const summary = () => ({
  equityUsd: 2000,
  freeCollateralUsd: -10,
  initialMarginUsd: 2010,
  maintenanceMarginUsd: null,
  settlementAsset: 'USDC',
  fetchedAt: Date.now(),
});
beforeEach(() => {
  mocks.account.mockReturnValue({ data: summary(), isError: false });
});
afterEach(cleanup);

describe('Paradex current equity', () => {
  it('shows equity separately from free collateral and only uses equity on request', () => {
    const useEquity = vi.fn();
    render(<ParadexAccountSummary onUseEquity={useEquity} />);
    expect(screen.getByText('$2,000.00')).toBeTruthy();
    expect(screen.getByText('-$10.00')).toBeTruthy();
    expect(useEquity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use equity for this plan' }));
    expect(useEquity).toHaveBeenCalledWith(2000);
  });

  it('shows the full exchange account address so users can identify a different saved account', () => {
    const venueAccount = '0x' + 'a'.repeat(64);
    mocks.account.mockReturnValue({ data: { ...summary(), venueAccount }, isError: false });
    render(<ParadexAccountSummary />);
    expect(screen.getByText(venueAccount)).toBeTruthy();
    expect(screen.getByText(/Connected account/)).toBeTruthy();
  });

  it('disables adopting cached equity when refresh fails', () => {
    mocks.account.mockReturnValue({ data: summary(), isError: true });
    const useEquity = vi.fn();
    render(<ParadexAccountSummary onUseEquity={useEquity} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use equity for this plan' }));
    expect(useEquity).not.toHaveBeenCalled();
    expect(screen.getByText(/Stale equity/)).toBeTruthy();
  });
});

it('shows a zero balance as zero, rather than a missing market', () => {
  mocks.account.mockReturnValue({
    data: { ...summary(), equityUsd: 0, freeCollateralUsd: 0 },
    isError: false,
  });
  render(<ParadexAccountSummary />);
  expect(screen.getAllByText('$0.00')).toHaveLength(2);
});
