import type { CryptoSectorQuote, CryptoSectorsResponse } from '@oggregator/protocol';
import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const q = (
  symbol: string,
  change: number | null,
  optionVenues: string[] = [],
): CryptoSectorQuote => ({
  symbol,
  label: symbol,
  last: 1.5,
  change,
  optionVenues,
});

const board: CryptoSectorsResponse = {
  asOf: Date.UTC(2026, 9, 13, 14, 5),
  venueCount: 9,
  tape: [{ ...q('BTC', -0.003), last: 83_316.8 }],
  baskets: [
    {
      id: 'rwa',
      name: 'RWA',
      rank: 1,
      mean: 0.01,
      median: 0.004,
      green: 4,
      priced: 6,
      members: [
        q('XAU', 0.03, ['binance', 'paradex']),
        q('MSTR', 0.02),
        q('SPCX', 0.01),
        q('META', 0.004),
        q('MU', -0.001),
        q('CL', -0.02),
        q('PAXG', null),
      ],
    },
  ],
};

vi.mock('./queries', () => ({
  useCryptoSectors: () => ({ data: board, isLoading: false, error: null }),
  useSectorCorrelation: () => ({ data: undefined, isLoading: true }),
}));

import SectorsView, { collapsedMembers, formatMove, formatPrice } from './SectorsView';

afterEach(() => {
  cleanup();
  useAppStore.setState({ underlying: 'BTC', activeTab: 'sectors' });
});

describe('SectorsView', () => {
  it('formats moves and crypto prices down to sub-cent coins', () => {
    expect(formatMove(-0.1223)).toBe('-12.23%');
    expect(formatPrice(83_316.8)).toBe('83,317');
    expect(formatPrice(2.107)).toBe('2.11');
    expect(formatPrice(0.0000040451)).toBe('0.000004045');
    expect(formatPrice(null)).toBe('—');
  });

  it('collapses to leaders and laggards', () => {
    expect(collapsedMembers(board.baskets[0]!.members).map((m) => m.symbol)).toEqual([
      'XAU',
      'MSTR',
      'MU',
      'CL',
    ]);
  });

  it('renders the tape, venue coverage, expands, and opens the chain for optionable assets', () => {
    render(<SectorsView />);

    expect(screen.getByText('14:05 UTC', { exact: false })).not.toBeNull();
    expect(screen.getByText('83,317')).not.toBeNull();
    expect(screen.getByText('#1 4/6 green · med +0.40%')).not.toBeNull();
    expect(screen.getByTitle('Options on binance, paradex').textContent).toBe('2/9');
    expect(screen.queryByText('SPCX')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+3 more ▾' }));
    expect(screen.getByText('SPCX')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'MSTR' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'XAU' }));
    expect(useAppStore.getState().underlying).toBe('XAU');
    expect(useAppStore.getState().activeTab).toBe('chain');
  });
});
