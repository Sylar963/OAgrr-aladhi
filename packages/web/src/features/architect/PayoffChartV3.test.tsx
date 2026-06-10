/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Leg } from './payoff';
import PayoffChartV3 from './PayoffChartV3';

afterEach(() => cleanup());

function makeLeg(over: Partial<Leg> = {}): Leg {
  return {
    id: 'leg-1', type: 'call', direction: 'buy', strike: 100, expiry: '2026-12-25',
    quantity: 1, entryPrice: 3, venue: 'deribit',
    delta: 0.5, gamma: 0.01, theta: -0.1, vega: 0.2, iv: 0.5, ...over,
  };
}

function renderChart(legs: Leg[]) {
  const points = legs.length
    ? [
        { underlyingPrice: 70, pnl: -3 },
        { underlyingPrice: 130, pnl: 27 },
      ]
    : [];
  return render(
    <PayoffChartV3
      points={points}
      breakevens={legs.length ? [103] : []}
      spotPrice={100}
      legs={legs}
      maxProfit={null}
      maxLoss={-3}
      netDebit={-3}
      strikes={[90, 95, 100, 105, 110]}
    />,
  );
}

describe('PayoffChartV3 (render)', () => {
  it('renders one block group per leg', () => {
    const { container } = renderChart([
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100 }),
      makeLeg({ id: 'leg-2', type: 'put', direction: 'buy', strike: 100 }),
    ]);
    const blocks = container.querySelectorAll('[data-leg-id]');
    expect(blocks.length).toBe(2);
  });

  it('labels a long call block "+1 C 100"', () => {
    const { container } = renderChart([makeLeg({ id: 'leg-1', strike: 100 })]);
    expect(container.textContent).toContain('+1 C 100');
  });

  it('shows the empty hint when there are no legs', () => {
    const { container } = renderChart([]);
    expect(container.textContent).toContain('click a rung');
  });

  it('renders an SVG (not a canvas) so jsdom can introspect it', () => {
    const { container } = renderChart([makeLeg()]);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });
});

import { fireEvent } from '@testing-library/react';

describe('PayoffChartV3 (crosshair)', () => {
  it('shows a net P&L readout chip when the ladder is hovered', () => {
    const { container } = renderChart([makeLeg({ id: 'leg-1', strike: 100 })]);
    const svg = container.querySelector('svg')!;
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 100 });
    const chip = container.querySelector('[data-testid="crosshair-chip"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('@');
  });
});

import { vi } from 'vitest';

describe('PayoffChartV3 (drag strike)', () => {
  it('fires onLegStrikeDrag with the snapped strike on drag release', () => {
    const onDrag = vi.fn();
    const points = [
      { underlyingPrice: 70, pnl: -3 },
      { underlyingPrice: 130, pnl: 27 },
    ];
    const { container } = render(
      <PayoffChartV3
        points={points}
        breakevens={[103]}
        spotPrice={100}
        legs={[makeLeg({ id: 'leg-1', strike: 100 })]}
        maxProfit={null}
        maxLoss={-3}
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onLegStrikeDrag={onDrag}
      />,
    );
    const group = container.querySelector('[data-leg-id="leg-1"]')!;
    // Drag downward in pixel space → lower price → expect a snapped strike below 100.
    fireEvent.pointerDown(group, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(container.querySelector('svg')!, { clientX: 300, clientY: 360 });
    fireEvent.pointerUp(container.querySelector('svg')!, { clientX: 300, clientY: 360 });
    expect(onDrag).toHaveBeenCalledTimes(1);
    const [legId, newStrike] = onDrag.mock.calls[0]!;
    expect(legId).toBe('leg-1');
    expect([90, 95]).toContain(newStrike);
  });
});

describe('PayoffChartV3 (remove)', () => {
  it('fires onRemoveLeg when the block remove control is clicked', () => {
    const onRemove = vi.fn();
    const points = [
      { underlyingPrice: 70, pnl: -3 },
      { underlyingPrice: 130, pnl: 27 },
    ];
    const { container } = render(
      <PayoffChartV3
        points={points}
        breakevens={[103]}
        spotPrice={100}
        legs={[makeLeg({ id: 'leg-1', strike: 100 })]}
        maxProfit={null}
        maxLoss={-3}
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onRemoveLeg={onRemove}
      />,
    );
    const removeBtn = container.querySelector('[data-remove-leg="leg-1"]')!;
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith('leg-1');
  });
});
