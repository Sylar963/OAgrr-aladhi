import type { EnrichedSide, VenueQuote } from '@shared/enriched';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExpandedRow from './ExpandedRow';
import { EXPANDED_COLUMN_IDS, useExpandedColumnsStore } from './expanded-columns-store';

// jsdom has no matchMedia — useIsMobile would throw.
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const emptySide = { venues: {} } as unknown as EnrichedSide;

afterEach(() => cleanup());
beforeEach(() => useExpandedColumnsStore.getState().setColumns(EXPANDED_COLUMN_IDS));

describe('ExpandedRow chartOverride', () => {
  it('enables the Chart button and calls chartOverride for a non-VenueId chain', () => {
    const onChart = vi.fn();
    render(
      <ExpandedRow
        strike={500}
        callSide={emptySide}
        putSide={emptySide}
        myIv={null}
        activeVenues={['tastytrade']}
        atmStrike={500}
        atmConsensusForward={null}
        underlying="SPY"
        expiry="2026-06-19"
        chartOverride={onChart}
      />,
    );
    const btns = screen.getAllByRole('button', { name: /chart/i });
    expect((btns[0] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btns[0]!);
    expect(onChart).toHaveBeenCalledWith({
      underlying: 'SPY',
      expiry: '2026-06-19',
      strike: 500,
      type: 'call',
    });
  });

  it('keeps the Chart button disabled (crypto path unchanged) when no override and no chart venue', () => {
    render(
      <ExpandedRow
        strike={500}
        callSide={emptySide}
        putSide={emptySide}
        myIv={null}
        activeVenues={['tastytrade']}
        atmStrike={500}
        atmConsensusForward={null}
        underlying="SPY"
        expiry="2026-06-19"
      />,
    );
    const btns = screen.getAllByRole('button', { name: /chart/i });
    expect((btns[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

function tollQuote(overrides: Partial<VenueQuote> = {}): VenueQuote {
  return {
    bid: 2,
    ask: 2.2,
    mid: 99,
    midRaw: null,
    bidSize: null,
    askSize: null,
    markIv: null,
    bidIv: null,
    askIv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: 9.5238,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    ...overrides,
  };
}

function renderTolls(venue = 'deribit', overrides: Partial<VenueQuote> = {}) {
  const side: EnrichedSide = {
    venues: { [venue]: tollQuote(overrides) },
    bestIv: null,
    bestVenue: null,
  };
  return render(
    <ExpandedRow
      strike={500}
      callSide={side}
      putSide={side}
      myIv={null}
      activeVenues={[venue]}
      atmStrike={500}
      atmConsensusForward={null}
      underlying={venue === 'tastytrade' ? 'SPY' : 'BTC'}
      expiry="2026-12-18"
    />,
  );
}

describe('ExpandedRow execution toll', () => {
  it.each([
    'deribit',
    'tastytrade',
  ])('shows bid/ask midpoint tolls on both sides for %s', (venue) => {
    renderTolls(venue);
    const tables = screen.getAllByRole('table');
    for (const table of tables) {
      expect(within(table).getByRole('columnheader', { name: 'TOLL %' })).toBeTruthy();
      expect(within(table).getByText('4.76%').getAttribute('title')).toContain('midpoint ($2.1)');
      expect(within(table).getByText('9.5%')).toBeTruthy();
    }
    const callHeaders = within(tables[0]!)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    const putHeaders = within(tables[1]!)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(putHeaders).toEqual([...callHeaders].reverse());
    for (const table of tables) {
      const headers = within(table).getAllByRole('columnheader');
      const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell');
      expect(cells[headers.findIndex((h) => h.textContent === 'TOLL %')]!.textContent).toBe(
        '4.76%',
      );
    }
  });

  it('flags crossing quotes against an optional cap shared by calls and puts', () => {
    renderTolls();
    const input = screen.getByRole('spinbutton', { name: 'MAX TOLL %' });
    expect(screen.queryByText('OVER CAP')).toBeNull();
    fireEvent.change(input, { target: { value: '4' } });
    expect(screen.getAllByText('OVER CAP')).toHaveLength(2);
    fireEvent.change(input, { target: { value: '5' } });
    expect(screen.queryByText('OVER CAP')).toBeNull();
    expect(
      screen.getAllByText('4.76%').every((el) => el.getAttribute('data-status') === 'within'),
    ).toBe(true);
    fireEvent.change(input, { target: { value: '' } });
    expect(
      screen.getAllByText('4.76%').every((el) => el.getAttribute('data-status') === 'uncapped'),
    ).toBe(true);
  });

  it.each(['-1', '101'])('does not apply an invalid cap of %s', (cap) => {
    renderTolls();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'MAX TOLL %' }), {
      target: { value: cap },
    });
    expect(
      screen.getAllByText('4.76%').every((el) => el.getAttribute('data-status') === 'uncapped'),
    ).toBe(true);
  });

  it.each([
    { bid: null },
    { bid: 0 },
    { ask: 1 },
    { asOfMs: Date.now() - 120_000 },
  ])('withholds tolls for missing, non-actionable, or crossed quotes: %j', (overrides) => {
    renderTolls('deribit', overrides);
    expect(screen.queryByText('4.76%')).toBeNull();
    expect(screen.getAllByTitle(/Toll unavailable/)).toHaveLength(2);
  });
});

describe('ExpandedRow column selection', () => {
  function openColumns() {
    fireEvent.click(screen.getByText('Columns'));
  }

  it('shows the requested compact preset with matching cells in both mirrored tables', () => {
    renderTolls('deribit', { mid: 2.1, bidIv: 0.48, markIv: 0.5 });
    openColumns();
    fireEvent.click(screen.getByRole('button', { name: 'MID + IV + TOLL' }));
    const tables = screen.getAllByRole('table');
    const expectedHeaders = ['VENUE', 'MID', 'IV BID', 'IV MARK', 'TOLL %'];
    const expectedCells = ['DER', '$2.10', '48.0%', '50.0%', '4.76%'];
    for (const [index, table] of tables.entries()) {
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((el) => el.textContent);
      const row = within(table).getAllByRole('row')[1]!;
      const cells = within(row)
        .getAllByRole('cell')
        .map((el) => el.textContent);
      expect(headers).toEqual(index === 0 ? expectedHeaders : [...expectedHeaders].reverse());
      expect(cells).toEqual(index === 0 ? expectedCells : [...expectedCells].reverse());
    }
    expect((screen.getByRole('checkbox', { name: 'VENUE' }) as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it('lets individual columns be toggled and restores all fields', () => {
    renderTolls();
    openColumns();
    fireEvent.click(screen.getByRole('checkbox', { name: 'BID' }));
    expect(screen.queryByRole('columnheader', { name: 'BID' })).toBeNull();
    expect(screen.getAllByRole('columnheader', { name: 'IV BID' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'BID' }));
    expect(screen.getAllByRole('columnheader', { name: 'BID' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'MID + IV + TOLL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    for (const table of screen.getAllByRole('table')) {
      expect(within(table).getAllByRole('columnheader')).toHaveLength(
        EXPANDED_COLUMN_IDS.length + 1,
      );
    }
  });

  it('retains the selection when another strike or market opens', () => {
    const view = renderTolls();
    openColumns();
    fireEvent.click(screen.getByRole('button', { name: 'MID + IV + TOLL' }));
    view.unmount();
    renderTolls('tastytrade');
    for (const table of screen.getAllByRole('table')) {
      expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
      expect(within(table).getByRole('columnheader', { name: 'TOLL %' })).toBeTruthy();
    }
  });
});
