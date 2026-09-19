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
  it('marks the current surface and switches from shock impact to total open P&L', () => {
    render(<ShockHeatmap grid={grid} meta={meta} currentUnrealizedPnl={-12.5} />);

    expect(screen.getAllByText('You are here')).toHaveLength(2);
    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('$0');
    expect(screen.getByText('2/2 legs')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Total open P&L' }));

    expect(screen.getByTestId('current-shock-cell-value').textContent).toBe('-$12.50');
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
});
