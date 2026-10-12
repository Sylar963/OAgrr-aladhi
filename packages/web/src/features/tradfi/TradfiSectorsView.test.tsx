import type { TradfiSectorQuote, TradfiSectorsResponse } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const q = (symbol: string, change: number | null, hasOptions = false): TradfiSectorQuote => ({
  symbol,
  label: symbol,
  last: 100,
  prevClose: 100,
  change,
  hasOptions,
});

const board: TradfiSectorsResponse = {
  asOf: Date.UTC(2026, 9, 12, 15, 45),
  prevCloseDate: '2026-10-09',
  tape: [{ ...q('SPX', 0.001), last: 6_812.4 }],
  baskets: [
    {
      id: 'quantum',
      name: 'Quantum',
      rank: 1,
      mean: 0.02,
      median: 0.015,
      green: 5,
      priced: 6,
      members: [
        q('IONQ', 0.05, true),
        q('RGTI', 0.04),
        q('QBTS', 0.02),
        q('QUBT', 0.01),
        q('ARQQ', 0.005),
        q('LAES', -0.01),
        q('QTUM', null),
      ],
    },
  ],
};

vi.mock('./queries', () => ({
  useTradfiSectors: () => ({ data: board, isLoading: false, error: null }),
}));

import TradfiSectorsView, { collapsedMembers, formatMove } from './TradfiSectorsView';

afterEach(() => {
  cleanup();
  useAppStore.setState({ tradfiUnderlying: '', tradfiPage: 'sectors' });
});

describe('TradfiSectorsView', () => {
  it('formats moves with sign and two decimals', () => {
    expect(formatMove(0.0141)).toBe('+1.41%');
    expect(formatMove(-0.0581)).toBe('-5.81%');
    expect(formatMove(null)).toBe('—');
  });

  it('collapses to leaders and laggards', () => {
    expect(collapsedMembers(board.baskets[0]!.members).map((m) => m.symbol)).toEqual([
      'IONQ',
      'RGTI',
      'ARQQ',
      'LAES',
    ]);
  });

  it('renders the tape and basket tag, expands members, and opens optionable tickers', () => {
    render(<TradfiSectorsView />);

    expect(screen.getByText('Moves vs Fri, Oct 9', { exact: false })).not.toBeNull();
    expect(screen.getByText('6,812')).not.toBeNull();
    expect(screen.getByText('#1 5/6 green · med +1.50%')).not.toBeNull();
    expect(screen.queryByText('QBTS')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+3 more ▾' }));
    expect(screen.getByText('QBTS')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'RGTI' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'IONQ' }));
    expect(useAppStore.getState().tradfiUnderlying).toBe('IONQ');
    expect(useAppStore.getState().tradfiPage).toBe('chain');
  });
});
