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
  it('centres on now with no additional shock when no entry IV is known', () => {
    render(<ShockHeatmap grid={grid} meta={meta} currentUnrealizedPnl={-12.5} />);

    expect(screen.getByText('Live baseline')).toBeTruthy();
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('$0');
    expect(screen.getByTestId('open-pnl').textContent).toBe('-$12.50');
    expect(screen.queryByRole('button', { name: 'Total open P&L' })).toBeNull();
  });

  it('splits open P&L into spot, time, vol and other', () => {
    render(
      <ShockHeatmap
        grid={grid}
        meta={meta}
        currentUnrealizedPnl={95.22}
        attribution={{
          openPnlUsd: 95.22,
          spotUsd: 80,
          timeUsd: 12,
          volUsd: 2.5,
          otherUsd: 0.72,
          unattributedUsd: 0,
          attributedLegs: 2,
          totalLegs: 2,
        }}
      />,
    );

    expect(screen.getByText('Spot (Δ + Γ)').nextSibling?.textContent).toBe('+$80.00');
    expect(screen.getByText('Time (Θ)').nextSibling?.textContent).toBe('+$12.00');
    expect(screen.getByTestId('vol-pnl').textContent).toBe('+$2.50');
    expect(screen.queryByText(/No fills/)).toBeNull();
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

  it('defaults to the entry anchor and moves the now marker to the vol drift', () => {
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

    const nowCell = screen.getByTestId('current-shock-cell-value').closest('td');
    expect(nowCell?.getAttribute('title')).toContain('ATM +4.2 pts · skew +8');
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('+$50.00');
    expect(screen.getByText('Entry')).toBeTruthy();
    expect(screen.getByText(/first live IV this server recorded/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'From now' }));
    expect(screen.getByText('Live baseline')).toBeTruthy();
  });

  it('disables the entry anchor when no entry IV is known', () => {
    render(<ShockHeatmap grid={grid} meta={meta} currentUnrealizedPnl={0} />);
    expect((screen.getByRole('button', { name: 'From entry' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
