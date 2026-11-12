import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BreakEvenIvRow, PositionLeg, VegaByStrikeRow } from '@oggregator/protocol';

import PortfolioVegaCurve from './PortfolioVegaCurve';

const EXPIRIES = ['2026-11-13', '2026-11-27', '2026-12-25'];
const ROWS: VegaByStrikeRow[] = EXPIRIES.map((expiry, index) => ({
  expiry,
  strike: index === 2 ? 90_000 : 80_000,
  optionRight: 'call',
  delta: [0.3, -0.2, 0.4][index]!,
  vega: 10,
  gamma: 0.0001,
  theta: -5,
  vanna: 0.001,
  volga: 1,
  contracts: 1,
}));
const POSITIONS: PositionLeg[] = ROWS.map((row, index) => ({
  legId: `leg-${index}`,
  underlying: 'BTC',
  expiry: row.expiry,
  strike: row.strike,
  optionRight: row.optionRight,
  size: index === 1 ? -1 : 1,
  entryPriceUsd: 1_000,
  entryIv: 0.5,
  realizedPnlUsd: 0,
  entryTs: 0,
  venueHint: 'thalex',
  source: 'thalex',
}));
const BREAK_EVEN: BreakEvenIvRow[] = POSITIONS.map((leg) => ({
  legId: leg.legId,
  strike: leg.strike,
  expiry: leg.expiry,
  optionRight: leg.optionRight,
  entryIv: 0.5,
  currentMarkUsd: 1_000,
  currentIv: 0.5,
  breakEvenIv: 0.45,
  ivCushionPct: 0.05,
}));
const PROPS = {
  sourceLabel: 'Thalex',
  positions: POSITIONS,
  byStrike: ROWS,
  breakEven: BREAK_EVEN,
  spotUsd: 80_000,
  underlying: 'BTC',
};

afterEach(cleanup);

describe('PortfolioVegaCurve scope', () => {
  it('defaults to the full options book and keeps strike inspection independent of the hedge', () => {
    render(<PortfolioVegaCurve {...PROPS} />);

    expect(screen.getByRole('button', { name: 'Global book' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByRole('combobox', { name: 'Expiry' })).toBeNull();
    expect(screen.getByText('Thalex · BTC options · all strikes · all expiries')).toBeTruthy();
    expect(screen.getByText('SHORT 0.5 BTC-PERP')).toBeTruthy();
    expect(screen.getByText('+$400')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'By strike' }));
    fireEvent.click(screen.getByText('Strike 80,000 · +$80.00').closest('g')!);

    expect(screen.getByText('SHORT 0.5 BTC-PERP')).toBeTruthy();
    expect(screen.getByText('2026-11-13 · CALL')).toBeTruthy();
    expect(screen.getByText('2026-11-27 · CALL')).toBeTruthy();
  });

  it('switches all readouts to one expiry and remembers the chosen expiry after returning to the book', () => {
    render(<PortfolioVegaCurve {...PROPS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Single expiry' }));
    expect(screen.getByText('SHORT 0.3 BTC-PERP')).toBeTruthy();
    expect(screen.getByText('+$240')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Expiry' }), {
      target: { value: EXPIRIES[1] },
    });
    expect(screen.getByText('LONG 0.2 BTC-PERP')).toBeTruthy();
    expect(screen.getByText('-$160')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Global book' }));
    expect(screen.getByText('SHORT 0.5 BTC-PERP')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Single expiry' }));
    expect((screen.getByRole('combobox', { name: 'Expiry' }) as HTMLSelectElement).value).toBe(
      EXPIRIES[1],
    );
    expect(screen.getByText('LONG 0.2 BTC-PERP')).toBeTruthy();
  });

  it('selects a remaining expiry when the selected position closes', () => {
    const { rerender } = render(<PortfolioVegaCurve {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Single expiry' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Expiry' }), {
      target: { value: EXPIRIES[1] },
    });
    rerender(
      <PortfolioVegaCurve
        {...PROPS}
        positions={POSITIONS.filter((leg) => leg.expiry !== EXPIRIES[1])}
        byStrike={ROWS.filter((row) => row.expiry !== EXPIRIES[1])}
        breakEven={BREAK_EVEN.filter((row) => row.expiry !== EXPIRIES[1])}
      />,
    );
    expect(screen.getByText('SHORT 0.3 BTC-PERP')).toBeTruthy();
  });

  it('withholds incompatible BTC and ETH totals and hedge instructions', () => {
    render(
      <PortfolioVegaCurve
        {...PROPS}
        underlying="all"
        positions={POSITIONS.map((leg, index) => ({
          ...leg,
          underlying: index === 1 ? 'ETH' : 'BTC',
        }))}
      />,
    );
    expect(screen.getByText('Select one underlying to draw its curve.')).toBeTruthy();
    expect(screen.queryByText(/BTC-PERP/)).toBeNull();
    expect(screen.queryByText('Perp hedge to flatten')).toBeNull();
  });
});
