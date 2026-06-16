import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub the chart leaves (lightweight-charts createChart does not work in jsdom).
vi.mock('@features/chain', () => ({
  InstrumentChart: () => <div data-testid="price-chart" />,
  InstrumentAttributionChart: () => <div data-testid="attr-chart" />,
  AttributionSummary: () => <div data-testid="attr-summary" />,
}));

vi.mock('./use-tradfi-candles', () => ({
  useTradfiCandles: () => ({
    data: { candles: [{ ts: 1, o: 1, h: 1, l: 1, c: 1, vol: 0, synthetic: false }], markLine: [] },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('./use-tradfi-attribution', () => ({
  useTradfiAttribution: () => ({
    result: null,
    isLoading: false,
    error: null,
    insufficientData: true,
    displayCurrency: 'USD',
  }),
}));

import TradfiChartPanel from './TradfiChartPanel';

function renderPanel(mode: 'price' | 'attribution') {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TradfiChartPanel
        data={{
          underlying: 'SPY',
          expiry: '2026-06-19',
          strike: 500,
          type: 'call',
          interval: '1h',
          range: '7d',
          chartMode: mode,
        }}
        onPatch={() => {}}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe('TradfiChartPanel', () => {
  it('renders the price chart in price mode', () => {
    renderPanel('price');
    expect(screen.getByTestId('price-chart')).toBeTruthy();
  });

  it('shows the insufficient-data note in attribution mode when there is no result', () => {
    renderPanel('attribution');
    expect(screen.queryByTestId('attr-chart')).toBeNull();
    expect(screen.getByText(/insufficient/i)).toBeTruthy();
  });
});
