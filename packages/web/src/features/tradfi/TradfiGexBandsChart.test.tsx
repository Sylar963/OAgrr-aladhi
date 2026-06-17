/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let capturedOnBar: ((bar: { ts: number; o: number; h: number; l: number; c: number; vol: number }) => void) | null = null;

vi.mock('./use-tradfi-underlying-candles-live', () => ({
  useTradfiUnderlyingCandlesLive: (args: { onBar: (b: unknown) => void }) => {
    capturedOnBar = args.onBar as typeof capturedOnBar;
    return { connectionState: 'live' };
  },
}));

vi.mock('./use-tradfi-underlying-candles', () => ({
  useTradfiUnderlyingCandles: () => ({
    data: { candles: [{ ts: 1781553000000, o: 1, h: 1, l: 1, c: 1, vol: 0, synthetic: false }], markLine: [] },
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

const series = {
  setData: vi.fn(),
  update: vi.fn(),
  createPriceLine: vi.fn(() => ({})),
  removePriceLine: vi.fn(),
  attachPrimitive: vi.fn(),
};

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: {},
  ColorType: { Solid: 'solid' },
  LineStyle: { Solid: 0, Dashed: 1 },
  createChart: () => ({ addSeries: () => series, remove: () => {}, timeScale: () => ({}) }),
}));

vi.mock('@features/gex', () => ({
  computeGammaWalls: () => ({ callWall: 100, putWall: 90, gammaFlip: 95 }),
  GammaChannelPrimitive: class {
    update() {}
  },
}));

const { default: TradfiGexBandsChart } = await import('./TradfiGexBandsChart');

afterEach(() => {
  cleanup();
  capturedOnBar = null;
});

describe('TradfiGexBandsChart live wiring', () => {
  it('applies a live bar to the candlestick series via update', () => {
    render(<TradfiGexBandsChart underlying="SPX" gex={[]} spotPrice={100} />);
    expect(typeof capturedOnBar).toBe('function');
    capturedOnBar!({ ts: 1781553300000, o: 56, h: 57, l: 55, c: 56.5, vol: 3 });
    expect(series.update).toHaveBeenCalledWith(
      expect.objectContaining({ open: 56, high: 57, low: 55, close: 56.5 }),
    );
  });
});
