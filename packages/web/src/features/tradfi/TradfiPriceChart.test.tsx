import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// jsdom: no matchMedia
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

// lightweight-charts createChart does not work in jsdom — stub InstrumentChart
vi.mock('@features/chain/InstrumentChart', () => ({
  default: () => <div data-testid="instrument-chart" />,
}));

// Control useTradfiCandles so we can exercise different states
const mockUseTradfiCandles = vi.fn();
vi.mock('./use-tradfi-candles', () => ({
  useTradfiCandles: (...args: unknown[]) => mockUseTradfiCandles(...args),
  parseTradfiCandles: (raw: unknown) => raw,
}));

import TradfiPriceChart from './TradfiPriceChart';

afterEach(() => vi.clearAllMocks());

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const STRIKES = [290, 295, 300];

describe('TradfiPriceChart', () => {
  it('renders loading spinner when fetching', () => {
    mockUseTradfiCandles.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = wrap(
      <TradfiPriceChart underlying="AAPL" expiry="2026-06-20" strikes={STRIKES} atmStrike={295} />,
    );
    // Spinner renders its ring element
    expect(container.querySelector('[class*="ring"]')).toBeTruthy();
  });

  it('renders EmptyState when candles array is empty', () => {
    mockUseTradfiCandles.mockReturnValue({
      data: { candles: [], markLine: [] },
      isLoading: false,
    });
    const { container } = wrap(
      <TradfiPriceChart underlying="AAPL" expiry="2026-06-20" strikes={STRIKES} atmStrike={295} />,
    );
    // EmptyState renders its wrap element containing "No candle history"
    expect(container.textContent).toContain('No candle history');
  });

  it('renders InstrumentChart when candles are present', () => {
    mockUseTradfiCandles.mockReturnValue({
      data: {
        candles: [{ ts: 1, o: 1, h: 2, l: 0.5, c: 1.5, vol: 3, synthetic: false }],
        markLine: [],
      },
      isLoading: false,
    });
    const { getByTestId } = wrap(
      <TradfiPriceChart underlying="AAPL" expiry="2026-06-20" strikes={STRIKES} atmStrike={295} />,
    );
    expect(getByTestId('instrument-chart')).toBeTruthy();
  });

  it('renders strike selector with all strike options', () => {
    mockUseTradfiCandles.mockReturnValue({ data: undefined, isLoading: false });
    const { container } = wrap(
      <TradfiPriceChart underlying="AAPL" expiry="2026-06-20" strikes={STRIKES} atmStrike={295} />,
    );
    const select = container.querySelector('select[aria-label="Strike"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options).toHaveLength(STRIKES.length);
  });

  it('renders call/put toggle buttons', () => {
    mockUseTradfiCandles.mockReturnValue({ data: undefined, isLoading: false });
    const { container } = wrap(
      <TradfiPriceChart underlying="AAPL" expiry="2026-06-20" strikes={STRIKES} atmStrike={295} />,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    const labels = buttons.map((b) => b.textContent);
    expect(labels).toContain('CALL');
    expect(labels).toContain('PUT');
  });

  it('switching right side to PUT re-calls hook with right=put', () => {
    mockUseTradfiCandles.mockReturnValue({ data: undefined, isLoading: false });
    const { container } = wrap(
      <TradfiPriceChart underlying="AAPL" expiry="2026-06-20" strikes={STRIKES} atmStrike={295} />,
    );
    const putButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'PUT',
    )!;
    fireEvent.click(putButton);
    const calls = mockUseTradfiCandles.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[0].right).toBe('put');
  });

  it('renders without crashing when strikes list is empty', () => {
    mockUseTradfiCandles.mockReturnValue({ data: undefined, isLoading: false });
    expect(() =>
      wrap(
        <TradfiPriceChart underlying="AAPL" expiry="2026-06-20" strikes={[]} atmStrike={null} />,
      ),
    ).not.toThrow();
  });
});
