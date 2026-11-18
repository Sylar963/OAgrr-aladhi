import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowStrikeMapPoint } from '@oggregator/protocol';
import { FlowSpotChart } from './FlowMarketCharts';
import { flowBucketRange } from './flow-map-model';

const start = Date.parse('2026-11-18T00:00:00Z');
const range = { start: new Date(start).toISOString(), end: new Date(start + 60_000).toISOString() };
const point: FlowStrikeMapPoint = {
  bucketTs: start,
  optionType: 'put',
  side: 'sell',
  count: 7,
  contracts: 3.5,
  notionalUsd: 230_000,
};
const candle = { timestamp: start, open: 64_890, high: 64_900, low: 64_768, close: 64_820 };

afterEach(cleanup);

describe('historical FLOW chart', () => {
  it('shows a single candle and keeps a forming-bucket bubble visible and selectable', () => {
    const onSelectPoint = vi.fn();
    const { container } = render(
      <FlowSpotChart
        candles={[candle]}
        points={[point]}
        range={range}
        resolution={900}
        optionFilter="all"
        selectedPoint={null}
        onSelectPoint={onSelectPoint}
      />,
    );
    const bubble = screen.getByRole('button', { name: /put sell: 7 trades/ });
    expect(Number(bubble.getAttribute('cx'))).toBe(524);
    expect(Number(bubble.getAttribute('cy'))).toBeGreaterThan(22);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    fireEvent.click(bubble);
    expect(onSelectPoint).toHaveBeenCalledWith(point);
  });
  it('clips buckets to both custom-range boundaries', () => {
    const custom = {
      start: new Date(start + 120_000).toISOString(),
      end: new Date(start + 240_000).toISOString(),
    };
    expect(flowBucketRange(start, 900, custom)).toEqual({
      start: start + 120_000,
      end: start + 240_000,
      midpoint: start + 180_000,
    });
    expect(
      flowBucketRange(start, 900, {
        start: new Date(start).toISOString(),
        end: new Date(start + 900_000).toISOString(),
      }).midpoint,
    ).toBe(start + 450_000);
  });
  it('retains a candle overlapping a custom range that starts within the bucket', () => {
    const custom = {
      start: new Date(start + 120_000).toISOString(),
      end: new Date(start + 240_000).toISOString(),
    };
    const { container } = render(
      <FlowSpotChart
        candles={[candle]}
        points={[point]}
        range={custom}
        resolution={900}
        optionFilter="all"
        selectedPoint={null}
        onSelectPoint={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /put sell: 7 trades/ }).getAttribute('cx')).toBe(
      '524',
    );
    expect(container.querySelector('circle')?.getAttribute('cx')).toBe('72');
    expect(screen.queryByText('No underlying candles for this range')).toBeNull();
  });
  it('excludes points outside the requested time window', () => {
    render(
      <FlowSpotChart
        candles={[candle]}
        points={[{ ...point, bucketTs: start + 900_000 }]}
        range={range}
        resolution={900}
        optionFilter="all"
        selectedPoint={null}
        onSelectPoint={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
  it.each([
    { candlesLoading: true, message: 'Loading underlying candles…' },
    { candlesFailed: true, message: 'Could not load underlying candles. Try the range again.' },
  ])('distinguishes candle loading and failure from empty history', ({ message, ...state }) => {
    render(
      <FlowSpotChart
        candles={[]}
        points={[]}
        range={range}
        resolution={900}
        {...state}
        optionFilter="all"
        selectedPoint={null}
        onSelectPoint={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(message);
  });
});
