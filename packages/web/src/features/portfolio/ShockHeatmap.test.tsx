import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ShockHeatmap from './ShockHeatmap';

const grid = [[{ atmShiftVolPts: 0, skewShiftPerLogK: 0, totalPnlUsd: 0 }]];

const meta = {
  totalLegs: 2,
  pricedLegs: 2,
  excludedLegIds: [],
  anchor: 'per_leg_forward' as const,
};

afterEach(cleanup);

describe('ShockHeatmap', () => {
  it('defaults to live total P&L and offers incremental shock impact', () => {
    render(<ShockHeatmap grid={grid} meta={meta} currentUnrealizedPnl={-12.5} />);

    expect(screen.queryByText('You are here')).toBeNull();
    expect(screen.getByText('Live baseline')).toBeTruthy();
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('-$12.50');
    expect(screen.getByText('2/2 legs')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Shock impact' }));

    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('$0');
  });

  it('updates the center with live P&L and does not fabricate missing P&L', () => {
    const view = render(<ShockHeatmap grid={grid} meta={meta} currentUnrealizedPnl={4} />);
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('+$4.00');
    view.rerender(<ShockHeatmap grid={grid} meta={meta} currentUnrealizedPnl={7} />);
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('+$7.00');
    view.rerender(<ShockHeatmap grid={grid} meta={meta} currentUnrealizedPnl={null} />);
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('—');
  });

  it('discloses positions excluded from repricing', () => {
    render(
      <ShockHeatmap
        grid={grid}
        meta={{ ...meta, pricedLegs: 1, excludedLegIds: ['leg-2'] }}
        currentUnrealizedPnl={0}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('1 leg excluded');
  });

  it('moves the now marker to the vol drift since entry', () => {
    const atm = [-5, 0, 5];
    const skew = [-0.1, 0, 0.1];
    const entryGrid = atm.map((a) =>
      skew.map((k) => ({ atmShiftVolPts: a, skewShiftPerLogK: k, totalPnlUsd: a * 10 + k * 100 - 50 })),
    );
    const nowGrid = atm.map((a) =>
      skew.map((k) => ({ atmShiftVolPts: a, skewShiftPerLogK: k, totalPnlUsd: 0 })),
    );
    render(
      <ShockHeatmap
        grid={nowGrid}
        meta={meta}
        entryGrid={entryGrid}
        entryDrift={{
          atmShiftVolPts: 4.2,
          skewShiftPerLogK: 0.08,
          volPnlUsd: 40,
          anchoredLegs: 2,
          basis: 'first_seen',
        }}
        currentUnrealizedPnl={12}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'From entry' }));

    const nowCell = screen.getByTestId('current-shock-cell-value').closest('td');
    expect(nowCell?.getAttribute('title')).toContain('ATM +4.2 pts · skew +8');
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('+$22.00');
    expect(screen.getByText('Entry')).toBeTruthy();
    expect(screen.getByText(/first live IV this server recorded/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Shock impact' }));
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('+$50.00');
  });

  it('disables the entry anchor when no entry IV is known', () => {
    render(<ShockHeatmap grid={grid} meta={meta} currentUnrealizedPnl={0} />);
    expect((screen.getByRole('button', { name: 'From entry' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
