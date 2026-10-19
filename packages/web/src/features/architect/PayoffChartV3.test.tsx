/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(container.textContent).toContain('Click the chart');
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

  it('grows call boxes up from the strike line and put boxes down from it', () => {
    const { container } = renderChart([
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }),
      makeLeg({ id: 'leg-2', type: 'put', direction: 'buy', strike: 100, entryPrice: 3 }),
    ]);
    const strikeY = Number(
      container.querySelector('[data-leg-id="leg-1"] [data-strike-line]')!.getAttribute('y1'),
    );
    const callBody = container.querySelector('[data-leg-id="leg-1"] rect')!;
    const callBottom = Number(callBody.getAttribute('y')) + Number(callBody.getAttribute('height'));
    expect(callBottom).toBeCloseTo(strikeY, 5);
    const putBody = container.querySelector('[data-leg-id="leg-2"] rect')!;
    expect(Number(putBody.getAttribute('y'))).toBeCloseTo(strikeY, 5);
  });

  it('puts four studs on the growth edge: call bricks up, put bricks down', () => {
    const { container } = renderChart([
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }),
      makeLeg({ id: 'leg-2', type: 'put', direction: 'sell', strike: 100, entryPrice: 3 }),
    ]);
    const callBody = container.querySelector('[data-leg-id="leg-1"] [data-brick-body]')!;
    const callStuds = [...container.querySelectorAll('[data-leg-id="leg-1"] [data-stud]')];
    expect(callStuds).toHaveLength(4);
    for (const st of callStuds) {
      expect(Number(st.getAttribute('y'))).toBeLessThan(Number(callBody.getAttribute('y')));
    }
    const putBody = container.querySelector('[data-leg-id="leg-2"] [data-brick-body]')!;
    const putBottom = Number(putBody.getAttribute('y')) + Number(putBody.getAttribute('height'));
    const putStuds = [...container.querySelectorAll('[data-leg-id="leg-2"] [data-stud]')];
    expect(putStuds).toHaveLength(4);
    for (const st of putStuds) expect(Number(st.getAttribute('y'))).toBeGreaterThanOrEqual(putBottom);
  });

  it('colours a long strangle green call / red put', () => {
    const { container } = renderChart([
      makeLeg({ id: 'c', type: 'call', direction: 'buy', strike: 105 }),
      makeLeg({ id: 'p', type: 'put', direction: 'buy', strike: 95 }),
    ]);
    expect(container.querySelector('[data-leg-id="c"]')!.getAttribute('data-color')).toBe('green');
    expect(container.querySelector('[data-leg-id="p"]')!.getAttribute('data-color')).toBe('red');
  });

  it('colours a short-gamma structure orange', () => {
    const { container } = renderChart([
      makeLeg({ id: 'c', type: 'call', direction: 'sell', strike: 105 }),
      makeLeg({ id: 'p', type: 'put', direction: 'sell', strike: 95 }),
    ]);
    const colors = [...container.querySelectorAll('[data-leg-id]')].map((g) => g.getAttribute('data-color'));
    expect(colors).toEqual(['orange', 'orange']);
  });

  it('pins each position to the price axis with an exact strike tag', () => {
    const { container } = renderChart([makeLeg({ id: 'leg-1', strike: 100 })]);
    expect(container.querySelector('[data-strike-tag="leg-1"]')!.textContent).toBe('100');
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

  it('renders bricks translucent, the short leg fainter than the long', () => {
    const { container } = renderSpread();
    const op = (id: string) =>
      Number(container.querySelector(`[data-leg-id="${id}"] [data-brick-body]`)!.getAttribute('fill-opacity'));
    expect(op('long')).toBeLessThan(1);
    expect(op('short')).toBeLessThan(op('long'));
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
  // Calendar axis: now pinned 28 days before each evenly spaced expiry. Bricks
  // reserve a pane left of now, so pixel positions are read from the DOM.
  const TENORS = ['2026-06-29', '2026-07-27', '2026-08-24'];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T08:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const lineX = (c: HTMLElement, tenor: string) =>
    Number(c.querySelector(`[data-expiry-line="${tenor}"]`)!.getAttribute('x1'));

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
    expect(container.textContent).toContain('29 JUN');
    expect(container.textContent).toContain('27 JUL');
    expect(container.textContent).toContain('24 AUG');
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

  it('stands calendar legs side by side, each lifeline ending at its own expiry', () => {
    const { container } = renderTenors([
      makeLeg({ id: 'near', strike: 100, expiry: TENORS[0] }),
      makeLeg({ id: 'far', direction: 'sell', strike: 100, expiry: TENORS[2] }),
    ]);
    const bodyX = (id: string) =>
      Number(container.querySelector(`[data-leg-id="${id}"] [data-brick-body]`)!.getAttribute('x'));
    expect(Math.abs(bodyX('far') - bodyX('near'))).toBeGreaterThanOrEqual(96);
    const end = (id: string) =>
      Number(container.querySelector(`[data-leg-id="${id}"] [data-strike-line]`)!.getAttribute('x2'));
    expect(end('near')).toBeCloseTo(lineX(container, TENORS[0]!), 5);
    expect(end('far')).toBeCloseTo(lineX(container, TENORS[2]!), 5);
  });

  it('places each brick on the price pane left of now, lifeline to its expiry', () => {
    const { container } = renderTenors([makeLeg({ id: 'leg-1', expiry: TENORS[1] })]);
    const nowX = Number(container.querySelector('[data-now-line]')!.getAttribute('x1'));
    const body = container.querySelector('[data-leg-id="leg-1"] [data-brick-body]')!;
    const right = Number(body.getAttribute('x')) + Number(body.getAttribute('width'));
    expect(right).toBeLessThan(nowX);
    const life = container.querySelector('[data-leg-id="leg-1"] [data-strike-line]')!;
    expect(Number(life.getAttribute('x1'))).toBeCloseTo(right, 5);
    expect(Number(life.getAttribute('x2'))).toBeCloseTo(lineX(container, TENORS[1]!), 5);
    expect(container.querySelector('[data-leg-id="leg-1"] [data-expiry-cap]')).not.toBeNull();
  });

  it('drags a box rightward from its expiry edge onto the next tenor', () => {
    const onTenor = vi.fn();
    const { container } = renderTenors(
      [makeLeg({ id: 'leg-1', strike: 100, expiry: TENORS[0] })],
      { onLegTenorDrag: onTenor, strikes: [100] },
    );
    const svg = container.querySelector('svg')!;
    // Grabbed near "now" (far left of the box): the gesture still moves the
    // expiry edge by the pointer's travel, not to the column under the pointer.
    fireEvent.pointerDown(container.querySelector('[data-leg-id="leg-1"]')!, { clientX: 60, clientY: 200 });
    fireEvent.pointerMove(svg, { clientX: 220, clientY: 200, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 220, clientY: 200 });
    expect(onTenor).toHaveBeenCalledWith('leg-1', TENORS[1], 100);
  });

  it('paints a price × time P&L grid with profit and loss cells', () => {
    const { container } = renderTenors([
      makeLeg({ id: 'c', direction: 'sell', type: 'call', strike: 100, expiry: TENORS[2] }),
      makeLeg({ id: 'p', direction: 'sell', type: 'put', strike: 100, expiry: TENORS[2] }),
    ]);
    const cells = [...container.querySelectorAll('[data-testid="pnl-grid"] rect')];
    expect(cells.length).toBeGreaterThan(20);
    const fills = new Set(cells.map((c) => c.getAttribute('fill')));
    expect(fills).toContain('var(--lego-profit)');
    expect(fills).toContain('var(--lego-loss)');
  });

  it('marks the current-price row in break-even yellow, strongest on the now square', () => {
    const { container } = renderTenors([makeLeg({ expiry: TENORS[2] })]);
    const now = container.querySelectorAll('[data-spot-cell="now"]');
    expect(now).toHaveLength(1);
    expect(now[0]!.getAttribute('fill')).toBe('var(--lego-be)');
    expect(container.querySelectorAll('[data-spot-cell="row"]').length).toBeGreaterThan(5);
  });

  it('draws the ±1σ and ±2σ expected-move cone', () => {
    const { container } = renderTenors([makeLeg({ expiry: TENORS[0] })]);
    expect(container.querySelector('[data-cone="1"]')).not.toBeNull();
    expect(container.querySelector('[data-cone="2"]')).not.toBeNull();
  });

  it('crosshair reads P&L at the hovered date', () => {
    const { container } = renderTenors([makeLeg({ expiry: TENORS[2] })]);
    fireEvent.pointerMove(container.querySelector('svg')!, {
      clientX: lineX(container, TENORS[0]!),
      clientY: 200,
    });
    expect(container.querySelector('[data-testid="crosshair-chip"]')!.textContent).toContain('29 JUN');
  });

  it('drags a block onto another tenor column and fires onLegTenorDrag', () => {
    const onTenor = vi.fn();
    const onStrike = vi.fn();
    const { container } = renderTenors(
      [makeLeg({ id: 'leg-1', strike: 100, expiry: TENORS[0] })],
      { onLegTenorDrag: onTenor, onLegStrikeDrag: onStrike, strikes: [100] },
    );
    const svg = container.querySelector('svg')!;
    // Sideways travel of one column's width moves the expiry one column out.
    const step = lineX(container, TENORS[1]!) - lineX(container, TENORS[0]!);
    fireEvent.pointerDown(container.querySelector('[data-leg-id="leg-1"]')!, { clientX: 100, clientY: 200 });
    fireEvent.pointerMove(svg, { clientX: 100 + step, clientY: 200, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 100 + step, clientY: 200 });
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
    const midFar = (lineX(container, TENORS[1]!) + lineX(container, TENORS[2]!)) / 2;
    fireEvent.click(svg, { clientX: midFar, clientY: 200 });
    fireEvent.click(container.querySelector('[data-add="buy-call"]')!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]![4]).toBe(TENORS[2]);
  });
});

describe('PayoffChartV3 (price history)', () => {
  const TENORS = ['2026-06-29', '2026-07-27'];
  const HOUR = 3_600_000;
  const NOW = Date.parse('2026-06-01T08:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => vi.useRealTimers());

  function candles(n: number, base: number, swing: number) {
    return Array.from({ length: n }, (_, i) => {
      const open = base + Math.sin(i / 3) * swing;
      const close = base + Math.sin((i + 1) / 3) * swing;
      return {
        timestamp: NOW - (n - i) * HOUR,
        open,
        close,
        high: Math.max(open, close) + 0.5,
        low: Math.min(open, close) - 0.5,
      };
    });
  }

  function renderHistory(extra: Record<string, unknown> = {}) {
    return render(
      <PayoffChartV3
        points={[]}
        breakevens={[103]}
        spotPrice={100}
        legs={[makeLeg({ id: 'leg-1', strike: 100, expiry: TENORS[0] })]}
        netDebit={-3}
        strikes={[80, 90, 95, 100, 105, 110, 120]}
        tenors={TENORS}
        activeTenor={TENORS[0]}
        candles={candles(200, 100, 2)}
        candleIntervalLabel="1H"
        {...extra}
      />,
    );
  }

  it('draws candles left of now with the bricks placed over them', () => {
    const { container } = renderHistory();
    const nowX = Number(container.querySelector('[data-now-line]')!.getAttribute('x1'));
    const candleEls = [...container.querySelectorAll('[data-candle] rect')];
    expect(candleEls.length).toBeGreaterThan(10);
    // Only as many bars as fit the history pane.
    expect(candleEls.length).toBeLessThan(200);
    for (const c of candleEls) {
      expect(Number(c.getAttribute('x')) + Number(c.getAttribute('width'))).toBeLessThanOrEqual(nowX);
    }
    const brick = container.querySelector('[data-leg-id="leg-1"] [data-brick-body]')!;
    const left = Number(brick.getAttribute('x'));
    const firstCandleX = Math.min(...candleEls.map((c) => Number(c.getAttribute('x'))));
    expect(left).toBeGreaterThan(firstCandleX);
    expect(left + Number(brick.getAttribute('width'))).toBeLessThan(nowX);
    expect(container.textContent).toContain('price · 1H');
  });

  it('widens the price window so the visible candles stay on-screen', () => {
    const { container } = renderHistory({ candles: candles(200, 100, 18) });
    const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(labels).toContain('80');
    expect(labels).toContain('120');
  });

  it('draws no candles without price history, but still reserves the brick pane', () => {
    const { container } = renderHistory({ candles: [] });
    expect(container.querySelector('[data-testid="price-history"]')).toBeNull();
    expect(container.querySelector('[data-now-line]')).not.toBeNull();
  });
});
