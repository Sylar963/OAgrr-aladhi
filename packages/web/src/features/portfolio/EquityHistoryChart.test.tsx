import type { EquityHistoryResponse } from '@oggregator/protocol';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  setData: vi.fn(),
  seriesOptions: vi.fn(),
  timeOptions: vi.fn(),
}));

vi.mock('./hooks/queries', () => ({ useEquityHistory: mocks.history }));
vi.mock('lightweight-charts', () => ({
  BaselineSeries: {},
  ColorType: { Solid: 'solid' },
  createChart: () => ({
    addSeries: () => ({ setData: mocks.setData, applyOptions: mocks.seriesOptions }),
    timeScale: () => ({ applyOptions: mocks.timeOptions, fitContent: vi.fn() }),
    remove: vi.fn(),
  }),
}));

import EquityHistoryChart from './EquityHistoryChart';

const day = Date.UTC(2026, 10, 20);
const history: EquityHistoryResponse = {
  accountId: 'acct-test',
  venue: 'paradex',
  range: '1M',
  basis: 'venue_value',
  fetchedAt: day + 3_600_000,
  points: [
    { ts: day, equityUsd: 1_000 },
    { ts: day + 1_800_000, equityUsd: 1_050.25 },
    { ts: day + 3_600_000, equityUsd: 1_005.75 },
  ],
};

beforeEach(() => {
  mocks.history.mockReturnValue({ data: history, isError: false, isLoading: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('EquityHistoryChart', () => {
  it('plots every intraday value and displays cents in current equity and period change', () => {
    render(<EquityHistoryChart venue="paradex" />);

    expect(mocks.setData).toHaveBeenLastCalledWith([
      { time: day / 1000, value: 1_000 },
      { time: (day + 1_800_000) / 1000, value: 1_050.25 },
      { time: (day + 3_600_000) / 1000, value: 1_005.75 },
    ]);
    expect(mocks.timeOptions).toHaveBeenLastCalledWith({ timeVisible: true });
    expect(screen.getByText(/equity \$1,005.75.*1M \+\$5.75/)).toBeTruthy();
    expect(screen.getByText(/hourly detail/)).toBeTruthy();
    expect(screen.getByText(/period change is not trading P&L/)).toBeTruthy();
  });

  it('clears the previous venue curve when the selected venue changes', () => {
    const view = render(<EquityHistoryChart venue="paradex" />);
    view.rerender(<EquityHistoryChart venue="derive" />);

    expect(mocks.setData).toHaveBeenLastCalledWith([]);
    expect(mocks.timeOptions).toHaveBeenLastCalledWith({ timeVisible: false });
  });
});
