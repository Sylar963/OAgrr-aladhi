import type { TimeAtPriceResponse } from '@oggregator/protocol';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TimeAtPrice from './TimeAtPrice';

const chart = vi.hoisted(() => ({
  resize: vi.fn(),
  fit: vi.fn(),
  setData: vi.fn(),
  remove: vi.fn(),
  attach: vi.fn(),
}));
vi.mock('lightweight-charts', async (original) => ({
  ...(await original<typeof import('lightweight-charts')>()),
  createChart: () => ({
    resize: chart.resize,
    timeScale: () => ({ fitContent: chart.fit }),
    addSeries: () => ({ setData: chart.setData, attachPrimitive: chart.attach }),
    remove: chart.remove,
  }),
}));
vi.mock('../queries', () => ({
  useTimeAtPrice: () => ({ data: fixture, isLoading: false, isError: false }),
}));
const fixture: TimeAtPriceResponse = {
  underlying: 'BTC',
  asOf: 86400000,
  lookbackDays: 730,
  resolutionSec: 3600,
  from: 0,
  to: 82800000,
  bars: 24,
  spot: 100,
  binSize: 1,
  volBinSize: 10,
  volWindowHours: 168,
  levels: [{ price: 100, bars: 24 }],
  volByLevel: [],
  hoursByLevel: [{ price: 100, bars: 24 }],
  dailyCloses: [{ ts: 0, close: 100 }],
  dailyActivity: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('sizes the canvas before fitting history when shown, and restores cached history after a tab remount', () => {
  const observers: {
    notify: (width: number, height: number) => void;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({
          disconnect: this.disconnect,
          notify: (width, height) =>
            callback(
              [{ contentRect: { width, height } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            ),
        });
      }
    },
  );
  const first = render(<TimeAtPrice underlying="BTC" />);
  chart.fit.mockClear();
  observers[0]!.notify(0, 0);
  expect(chart.resize).not.toHaveBeenCalled();
  expect(chart.fit).not.toHaveBeenCalled();
  observers[0]!.notify(900, 360);
  expect(chart.resize).toHaveBeenCalledWith(900, 360);
  expect(chart.resize.mock.invocationCallOrder[0]).toBeLessThan(
    chart.fit.mock.invocationCallOrder[0]!,
  );
  first.unmount();
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
  expect(chart.remove).toHaveBeenCalledOnce();
  render(<TimeAtPrice underlying="BTC" />);
  expect(chart.setData).toHaveBeenCalledTimes(2);
  expect(chart.setData).toHaveBeenLastCalledWith([{ time: 0, value: 100 }]);
  observers[1]!.notify(1200, 460);
  expect(chart.resize).toHaveBeenLastCalledWith(1200, 460);
});
