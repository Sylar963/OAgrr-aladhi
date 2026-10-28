import type { CloseNowLeg, PortfolioCloseNow, StrategyGroup } from '@oggregator/protocol';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@lib/i18n';

import StrategyGroupsPanel from './StrategyGroups';

const NOW = Date.UTC(2026, 9, 28, 12);
const group: StrategyGroup = {
  groupId: 'spread', kind: 'put_spread', underlying: 'BTC', expiry: '2026-10-30',
  legIds: ['long', 'short'],
  legs: [
    { legId: 'long', strike: 81_000, optionRight: 'put', size: 0.01, entryPriceUsd: 1535 },
    { legId: 'short', strike: 83_000, optionRight: 'put', size: -0.01, entryPriceUsd: 2845 },
  ],
  netEntryPremiumUsd: -13.10, debitOrCredit: 'credit',
  grossDebitUsd: 15.35, grossCreditUsd: 28.45,
  maxProfitUsd: 13.10, maxLossUsd: 6.90, breakEvenSpotsUsd: [81_690],
  totals: {
    netDeltaCoin: 0, optionsDeltaCoin: 0, linearDeltaCoin: 0,
    netGammaUsd: 0, netVegaUsd: 0, netThetaUsd: 0, netVannaUsd: 0, netVolgaUsd: 0,
    unrealizedPnlUsd: 5,
  },
};

function quote(legId: string, side: 'buy' | 'sell', cash: number): CloseNowLeg {
  return {
    legId, venue: 'thalex', instrument: null, status: 'ok', unavailableReason: null,
    side, size: 0.01, filledSize: 0.01, exitVwapUsd: Math.abs(cash) / 0.01,
    feesUsd: 0.1, exitCashUsd: cash, venueMarkUsd: 2_000, collarLimitUsd: null,
    markPnlUsd: null, closeNowPnlUsd: null, exitCostUsd: null, giveBackPct: null,
    spread: null, stale: false, bookAgeMs: 0, peak: null,
  };
}

function books(): PortfolioCloseNow {
  return {
    computedAt: NOW,
    legs: [quote('long', 'sell', 10), quote('short', 'buy', -27.69)],
    strategies: [],
    portfolio: {
      markPnlUsd: 5, closeNowPnlUsd: -4.59, exitCostUsd: 9.59,
      giveBackPct: null, exitCashUsd: -17.69, feesUsd: 0.2,
      legCount: 2, pricedLegCount: 2, complete: true, stale: false, peak: null,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useLocaleStore.getState().setLocale('en');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useLocaleStore.getState().setLocale('en');
});

describe('StrategyGroupsPanel bid/ask P&L', () => {
  it('separates the loss from cash to close and refreshes with new quotes', () => {
    const data = books();
    const { rerender } = render(<StrategyGroupsPanel groups={[group]} closeNow={data} />);
    expect(screen.getByRole('columnheader', { name: 'Unrealized P&L Bid / ask' })).toBeTruthy();
    expect(screen.getAllByText('-$4.59')).toHaveLength(3);
    expect(screen.getAllByText('-$17.69')).toHaveLength(2);
    expect(screen.getAllByText('exit fees $0.20')).toHaveLength(3);
    expect(screen.queryByText('+$5.00')).toBeNull();

    data.legs[1] = quote('short', 'buy', -20);
    rerender(<StrategyGroupsPanel groups={[group]} closeNow={{ ...data }} />);
    expect(screen.getAllByText('+$3.10')).toHaveLength(3);
    expect(screen.queryByText('-$4.59')).toBeNull();
  });

  it('marks retained prices stale when the stream stops, and clears on a fresh update', () => {
    const { rerender } = render(<StrategyGroupsPanel groups={[group]} closeNow={books()} />);
    expect(screen.queryByText('Stale · last estimate')).toBeNull();
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getAllByText('Stale · last estimate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-$4.59')).toHaveLength(3);
    rerender(<StrategyGroupsPanel groups={[group]} closeNow={{ ...books(), computedAt: Date.now() }} />);
    expect(screen.queryByText('Stale · last estimate')).toBeNull();
  });

  it('shows stale book status even while portfolio updates are fresh', () => {
    const data = books();
    data.legs[0]!.stale = true;
    render(<StrategyGroupsPanel groups={[group]} closeNow={data} />);
    expect(screen.getAllByText('Stale · last estimate').length).toBeGreaterThan(0);
  });

  it.each(['no_bid', 'no_ask', 'partial', 'unsupported_venue', 'book_unavailable'] as const)(
    'does not present a partial total or a mark fallback with %s', (status) => {
      const data = books();
      data.legs[1] = { ...data.legs[1]!, status, filledSize: 0, exitCashUsd: null };
      const extra: StrategyGroup = {
        ...group, groupId: 'extra', kind: 'naked', legIds: ['extra'],
        legs: [{ ...group.legs[0]!, legId: 'extra' }], netEntryPremiumUsd: 1,
      };
      data.legs.push(quote('extra', 'sell', 10));
      render(<StrategyGroupsPanel groups={[group, extra]} closeNow={data} />);
      const total = screen.getByRole('rowheader', { name: 'Open book' }).parentElement!;
      const pnlCell = within(total).getAllByRole('cell').at(-1)!;
      expect(pnlCell.textContent).toContain('—');
      expect(pnlCell.textContent).toContain('1 of 2 groups unpriced');
      expect(screen.getAllByText('+$9.00')).toHaveLength(1);
      expect(screen.queryByText('-$4.59')).toBeNull();
    },
  );

  it('keeps unavailable books distinct from zero P&L', () => {
    render(<StrategyGroupsPanel groups={[group]} closeNow={null} />);
    expect(screen.getAllByText('order books off').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('shows debit-position profit and preserves cents for larger P&L', () => {
    const debit: StrategyGroup = {
      ...group, kind: 'naked', legIds: ['long'], legs: [group.legs[0]!], netEntryPremiumUsd: 15.35,
    };
    const data = books();
    data.legs = [quote('long', 'sell', 138.80)];
    render(<StrategyGroupsPanel groups={[debit]} closeNow={data} />);
    expect(screen.getAllByText('+$123.45')).toHaveLength(3);
  });

  it('translates the P&L labels into Spanish', () => {
    useLocaleStore.getState().setLocale('es');
    render(<StrategyGroupsPanel groups={[group]} closeNow={books()} />);
    expect(screen.getByRole('columnheader', { name: 'P&L no realizado Bid / ask' })).toBeTruthy();
    expect(screen.getAllByText('comisiones de salida $0.20')).toHaveLength(3);
  });
});
