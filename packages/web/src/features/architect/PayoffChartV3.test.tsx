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

  it('gives blocks real vertical height (tight ladder domain, not a sliver)', () => {
    // Over the wide payoff-curve range this block collapsed to the 6px floor;
    // the strike-anchored domain must make it a readable chunk of the plot.
    const { container } = renderChart([
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }),
    ]);
    const rect = container.querySelector('[data-leg-id="leg-1"] rect')!;
    expect(Number(rect.getAttribute('height'))).toBeGreaterThan(40);
  });

  it('renders two lego studs per block, on the growth edge (call up, put down)', () => {
    const { container } = renderChart([
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }),
      makeLeg({ id: 'leg-2', type: 'put', direction: 'buy', strike: 100, entryPrice: 3 }),
    ]);
    const callBody = container.querySelector('[data-leg-id="leg-1"] rect')!;
    const callStuds = container.querySelectorAll('[data-leg-id="leg-1"] [data-stud]');
    expect(callStuds.length).toBe(2);
    // Call brick: studs protrude above the body's top edge.
    expect(Number(callStuds[0]!.getAttribute('y'))).toBeLessThan(Number(callBody.getAttribute('y')));

    const putBody = container.querySelector('[data-leg-id="leg-2"] rect')!;
    const putStuds = container.querySelectorAll('[data-leg-id="leg-2"] [data-stud]');
    expect(putStuds.length).toBe(2);
    // Put brick: studs protrude below the body's bottom edge.
    const putBottom = Number(putBody.getAttribute('y')) + Number(putBody.getAttribute('height'));
    expect(Number(putStuds[0]!.getAttribute('y'))).toBeGreaterThanOrEqual(putBottom);
  });

  it('draws nearby strikes as labeled rungs', () => {
    // 95 and 105 appear nowhere else (block is "+1 C 100", spot 100, BE 103),
    // so their presence proves the strike rungs render.
    const { container } = renderChart([makeLeg({ id: 'leg-1', strike: 100 })]);
    expect(container.textContent).toContain('95');
    expect(container.textContent).toContain('105');
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
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onLegStrikeDrag={onDrag}
      />,
    );
    const group = container.querySelector('[data-leg-id="leg-1"]')!;
    // Drag downward in pixel space → lower price → expect a snapped strike below 100.
    fireEvent.pointerDown(group, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(container.querySelector('svg')!, { clientX: 300, clientY: 360, buttons: 1 });
    fireEvent.pointerUp(container.querySelector('svg')!, { clientX: 300, clientY: 360 });
    expect(onDrag).toHaveBeenCalledTimes(1);
    const [legId, newStrike] = onDrag.mock.calls[0]!;
    expect(legId).toBe('leg-1');
    expect([90, 95]).toContain(newStrike);
  });
});

describe('PayoffChartV3 (drag correctness)', () => {
  it('does not open a picker after a strike drag', () => {
    const onAdd = vi.fn();
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
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onAddLegAtStrike={onAdd}
        onLegStrikeDrag={vi.fn()}
      />,
    );
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(container.querySelector('[data-leg-id="leg-1"]')!, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 360, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 360 });
    fireEvent.click(svg, { clientX: 300, clientY: 360 });
    expect(container.querySelector('[data-add]')).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('ends a drag when the button is released outside the plot', () => {
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
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onLegStrikeDrag={onDrag}
      />,
    );
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(container.querySelector('[data-leg-id="leg-1"]')!, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 360, buttons: 1 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 360, buttons: 0 });
    expect(onDrag).toHaveBeenCalledTimes(1);
    const [, snapped] = onDrag.mock.calls[0]!;
    expect([90, 95]).toContain(snapped);
    // A further move must not keep changing the strike (drag has ended).
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 30, buttons: 1 });
    expect(onDrag).toHaveBeenCalledTimes(1);
  });

  it('break-even line re-flows during a strike drag', () => {
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
        legs={[makeLeg({ id: 'leg-1', strike: 100, entryPrice: 3 })]}
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onLegStrikeDrag={onDrag}
      />,
    );
    const beTextBefore = Array.from(container.querySelectorAll('text')).find((t) =>
      (t.textContent ?? '').includes('103'),
    );
    expect(beTextBefore).toBeTruthy();
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(container.querySelector('[data-leg-id="leg-1"]')!, { clientX: 300, clientY: 200 });
    // Drag upward in pixel space → higher price → snap strike up to 110.
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 30, buttons: 1 });
    const beTextAfter = Array.from(container.querySelectorAll('text')).find((t) =>
      (t.textContent ?? '').includes('113'),
    );
    expect(beTextAfter).toBeTruthy();
  });

  it('short-leg arrow is a visible (non-degenerate) triangle', () => {
    const points = [
      { underlyingPrice: 70, pnl: 3 },
      { underlyingPrice: 130, pnl: -27 },
    ];
    const { container } = render(
      <PayoffChartV3
        points={points}
        breakevens={[103]}
        spotPrice={100}
        legs={[makeLeg({ id: 'leg-1', type: 'call', direction: 'sell', strike: 100 })]}
        netDebit={3}
        strikes={[90, 95, 100, 105, 110]}
      />,
    );
    const polygon = container.querySelector('[data-leg-id="leg-1"] polygon')!;
    expect(polygon).not.toBeNull();
    const ys = (polygon.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pt) => Number(pt.split(',')[1]));
    expect(ys.length).toBe(3);
    expect(new Set(ys).size).toBeGreaterThan(1);
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
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onRemoveLeg={onRemove}
      />,
    );
    const removeBtn = container.querySelector('[data-remove-leg="leg-1"]')!;
    fireEvent.click(removeBtn);
    fireEvent.animationEnd(container.querySelector('[data-leg-id="leg-1"]')!);
    expect(onRemove).toHaveBeenCalledWith('leg-1');
  });

  it('fades the block out then removes it', () => {
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
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onRemoveLeg={onRemove}
      />,
    );
    fireEvent.click(container.querySelector('[data-remove-leg="leg-1"]')!);
    const group = container.querySelector('[data-leg-id="leg-1"]')!;
    expect(group.getAttribute('class')).toContain('blockExit');
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.animationEnd(group);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('leg-1');
  });
});

describe('PayoffChartV3 (vertical spread snap)', () => {
  const spreadLegs: Leg[] = [
    makeLeg({ id: 'long', type: 'call', direction: 'buy', strike: 100, entryPrice: 4 }),
    makeLeg({ id: 'short', type: 'call', direction: 'sell', strike: 110, entryPrice: 1.5 }),
  ];
  function renderSpread(extra: Record<string, unknown> = {}) {
    return render(
      <PayoffChartV3
        points={[
          { underlyingPrice: 70, pnl: -2.5 },
          { underlyingPrice: 130, pnl: 7.5 },
        ]}
        breakevens={[102.5]}
        spotPrice={100}
        legs={spreadLegs}
        netDebit={-2.5}
        strikes={[90, 95, 100, 105, 110]}
        {...extra}
      />,
    );
  }

  it('fuses both legs under one spread group, each still a real leg block', () => {
    const { container } = renderSpread();
    const group = container.querySelector('[data-spread-key]')!;
    expect(group).not.toBeNull();
    expect(container.querySelectorAll('[data-spread-key]').length).toBe(1);
    expect(group.querySelector('[data-leg-id="long"]')).not.toBeNull();
    expect(group.querySelector('[data-leg-id="short"]')).not.toBeNull();
  });

  it('renders the short leg with the standalone short look (hatched, not a bar)', () => {
    const { container } = renderSpread();
    const shortRect = container.querySelector('[data-leg-id="short"] rect')!;
    expect(shortRect.getAttribute('fill')).toContain('hatch');
    const longRect = container.querySelector('[data-leg-id="long"] rect')!;
    expect(longRect.getAttribute('fill')).toBe('var(--lego-call)');
  });

  it('drags a leg block and fires onLegStrikeDrag for that leg only', () => {
    const onDrag = vi.fn();
    const { container } = renderSpread({ onLegStrikeDrag: onDrag });
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(container.querySelector('[data-leg-id="long"]')!, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 360, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 360 });
    expect(onDrag).toHaveBeenCalledTimes(1);
    const [legId, newStrike] = onDrag.mock.calls[0]!;
    expect(legId).toBe('long');
    expect(newStrike).toBeLessThan(100);
  });

  it('removes a single leg (un-snaps to the other) via its remove control', () => {
    const onRemove = vi.fn();
    const { container } = renderSpread({ onRemoveLeg: onRemove });
    fireEvent.click(container.querySelector('[data-remove-leg="short"]')!);
    fireEvent.animationEnd(container.querySelector('[data-leg-id="short"]')!);
    expect(onRemove).toHaveBeenCalledWith('short');
  });

  it('leaves a naked short call as a per-leg block (not a spread)', () => {
    const { container } = render(
      <PayoffChartV3
        points={[
          { underlyingPrice: 70, pnl: 3 },
          { underlyingPrice: 130, pnl: -27 },
        ]}
        breakevens={[103]}
        spotPrice={100}
        legs={[makeLeg({ id: 'sc', type: 'call', direction: 'sell', strike: 100 })]}
        netDebit={3}
        strikes={[90, 95, 100, 105, 110]}
      />,
    );
    expect(container.querySelector('[data-leg-id="sc"]')).not.toBeNull();
    expect(container.querySelector('[data-spread-key]')).toBeNull();
  });
});

describe('PayoffChartV3 (placement)', () => {
  it('opens a picker on rung click and fires onAddLegAtStrike', () => {
    const onAdd = vi.fn();
    const { container } = render(
      <PayoffChartV3
        points={[]}
        breakevens={[]}
        spotPrice={100}
        legs={[]}
        netDebit={0}
        strikes={[90, 95, 100, 105, 110]}
        onAddLegAtStrike={onAdd}
      />,
    );
    const svg = container.querySelector('svg')!;
    fireEvent.click(svg, { clientX: 300, clientY: 200 });
    const buyCall = container.querySelector('[data-add="buy-call"]')!;
    expect(buyCall).not.toBeNull();
    fireEvent.click(buyCall);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [strike, type, direction, qty] = onAdd.mock.calls[0]!;
    expect([90, 95, 100, 105, 110]).toContain(strike);
    expect(type).toBe('call');
    expect(direction).toBe('buy');
    expect(qty).toBe(1);
  });

  it('does not open a picker when an existing leg block is clicked', () => {
    const onAdd = vi.fn();
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
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onAddLegAtStrike={onAdd}
      />,
    );
    // clientY inside the plot so the picker would open absent the target guard.
    fireEvent.click(container.querySelector('[data-leg-id="leg-1"]')!, { clientX: 300, clientY: 200 });
    expect(container.querySelector('[data-add="buy-call"]')).toBeNull();
  });

  it('keeps the picker open when the pointer crosses from the svg onto it', () => {
    // The picker overlay is a sibling of the svg: moving the mouse onto it
    // fires the svg's pointerleave. That must NOT dismiss the picker (it made
    // the buttons unclickable in real browsers); leaving the whole chart does.
    const onAdd = vi.fn();
    const { container } = render(
      <PayoffChartV3
        points={[]}
        breakevens={[]}
        spotPrice={100}
        legs={[]}
        netDebit={0}
        strikes={[90, 95, 100, 105, 110]}
        onAddLegAtStrike={onAdd}
      />,
    );
    const svg = container.querySelector('svg')!;
    fireEvent.click(svg, { clientX: 300, clientY: 200 });
    const pickerBtn = container.querySelector('[data-add="buy-call"]')!;
    expect(pickerBtn).not.toBeNull();
    // Pointer crosses svg → picker (stays inside the chart container).
    fireEvent.pointerLeave(svg, { relatedTarget: pickerBtn });
    expect(container.querySelector('[data-add="buy-call"]')).not.toBeNull();
    // Pointer leaves the chart entirely → picker closes.
    fireEvent.pointerLeave(container.firstElementChild!, { relatedTarget: document.body });
    expect(container.querySelector('[data-add="buy-call"]')).toBeNull();
  });

  it('passes no expiry from the picker when there is no tenor axis', () => {
    const onAdd = vi.fn();
    const { container } = render(
      <PayoffChartV3
        points={[]}
        breakevens={[]}
        spotPrice={100}
        legs={[]}
        netDebit={0}
        strikes={[90, 95, 100, 105, 110]}
        onAddLegAtStrike={onAdd}
      />,
    );
    fireEvent.click(container.querySelector('svg')!, { clientX: 300, clientY: 200 });
    fireEvent.click(container.querySelector('[data-add="buy-call"]')!);
    expect(onAdd.mock.calls[0]![4]).toBeUndefined();
  });

  it('does not open a picker (no double-fire) when the remove control is clicked', () => {
    const onAdd = vi.fn();
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
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        onAddLegAtStrike={onAdd}
        onRemoveLeg={onRemove}
      />,
    );
    // clientY inside the plot so the picker would double-fire absent the target guard.
    fireEvent.click(container.querySelector('[data-remove-leg="leg-1"]')!, { clientX: 300, clientY: 200 });
    fireEvent.animationEnd(container.querySelector('[data-leg-id="leg-1"]')!);
    expect(onRemove).toHaveBeenCalledWith('leg-1');
    expect(container.querySelector('[data-add="buy-call"]')).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('PayoffChartV3 (tenor columns)', () => {
  // Default jsdom size 600×400 → plotLeft 48, plotW 488 → colW ≈ 162.7;
  // column centers ≈ 129 / 292 / 455.
  const TENORS = ['2026-06-26', '2026-07-31', '2026-09-25'];

  function renderTenors(legs: Leg[], extra: Record<string, unknown> = {}) {
    return render(
      <PayoffChartV3
        points={[]}
        breakevens={legs.length ? [103] : []}
        spotPrice={100}
        legs={legs}
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
        tenors={TENORS}
        activeTenor={TENORS[0]}
        {...extra}
      />,
    );
  }

  it('renders a tenor header with one label per column, active tenor marked', () => {
    const { container } = renderTenors([makeLeg({ expiry: TENORS[0] })]);
    expect(container.textContent).toContain('26 JUN');
    expect(container.textContent).toContain('31 JUL');
    expect(container.textContent).toContain('25 SEP');
    expect(container.querySelector(`[data-tenor="${TENORS[0]}"]`)!.getAttribute('data-active')).toBe('true');
    expect(container.querySelector(`[data-tenor="${TENORS[1]}"]`)!.getAttribute('data-active')).toBe('false');
  });

  it('renders no tenor header without a tenors prop', () => {
    const { container } = render(
      <PayoffChartV3
        points={[]}
        breakevens={[103]}
        spotPrice={100}
        legs={[makeLeg()]}
        netDebit={-3}
        strikes={[90, 95, 100, 105, 110]}
      />,
    );
    expect(container.querySelector('[data-tenor]')).toBeNull();
  });

  it('places calendar legs in their own tenor columns (distinct x)', () => {
    const { container } = renderTenors([
      makeLeg({ id: 'near', strike: 100, expiry: TENORS[0] }),
      makeLeg({ id: 'far', direction: 'sell', strike: 100, expiry: TENORS[2] }),
    ]);
    const nearX = Number(container.querySelector('[data-leg-id="near"] rect')!.getAttribute('x'));
    const farX = Number(container.querySelector('[data-leg-id="far"] rect')!.getAttribute('x'));
    // colW ≈ 162.7 — two columns apart means >300px between the blocks.
    expect(farX - nearX).toBeGreaterThan(300);
  });

  it('drags a block onto another tenor column and fires onLegTenorDrag', () => {
    const onTenor = vi.fn();
    const onStrike = vi.fn();
    const { container } = renderTenors(
      [makeLeg({ id: 'leg-1', strike: 100, expiry: TENORS[0] })],
      { onLegTenorDrag: onTenor, onLegStrikeDrag: onStrike, strikes: [100] },
    );
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(container.querySelector('[data-leg-id="leg-1"]')!, { clientX: 129, clientY: 200 });
    fireEvent.pointerMove(svg, { clientX: 292, clientY: 200, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 292, clientY: 200 });
    expect(onTenor).toHaveBeenCalledTimes(1);
    expect(onTenor).toHaveBeenCalledWith('leg-1', TENORS[1], 100);
    expect(onStrike).not.toHaveBeenCalled();
  });

  it('keeps a wobbly vertical drag on its home tenor (strike drag only)', () => {
    const onTenor = vi.fn();
    const onStrike = vi.fn();
    const { container } = renderTenors(
      [makeLeg({ id: 'leg-1', strike: 100, expiry: TENORS[0] })],
      { onLegTenorDrag: onTenor, onLegStrikeDrag: onStrike },
    );
    const svg = container.querySelector('svg')!;
    fireEvent.pointerDown(container.querySelector('[data-leg-id="leg-1"]')!, { clientX: 129, clientY: 200 });
    // 10px of x-wobble is under the engage threshold — must not hop columns.
    fireEvent.pointerMove(svg, { clientX: 139, clientY: 360, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 139, clientY: 360 });
    expect(onTenor).not.toHaveBeenCalled();
    expect(onStrike).toHaveBeenCalledTimes(1);
  });

  it('click-to-add in a far column passes that column tenor to onAddLegAtStrike', () => {
    const onAdd = vi.fn();
    const { container } = renderTenors([], { onAddLegAtStrike: onAdd });
    const svg = container.querySelector('svg')!;
    fireEvent.click(svg, { clientX: 455, clientY: 200 });
    fireEvent.click(container.querySelector('[data-add="buy-call"]')!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]![4]).toBe(TENORS[2]);
  });
});
