import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const makeSeries = () => ({ setData: vi.fn(), applyOptions: vi.fn(), attachPrimitive: vi.fn(), createPriceLine: vi.fn(() => ({})), removePriceLine: vi.fn() });
const series: ReturnType<typeof makeSeries>[] = [];
vi.mock('lightweight-charts', () => ({
  CandlestickSeries: {}, LineSeries: {}, ColorType: { Solid: 'solid' }, LineStyle: { Solid: 0 },
  createChart: () => ({
    addSeries: () => { const s = makeSeries(); series.push(s); return s; },
    remove: () => {}, timeScale: () => ({ setVisibleLogicalRange: () => {} }),
  }),
}));
vi.mock('./GammaBandsPrimitive', () => ({
  CALL_WALL_COLOR: '#00E997', PUT_WALL_COLOR: '#CB3855',
  GammaBandsPrimitive: class { update() {} setLabels() {} },
}));
const fetchJson = vi.fn(async (_path: string) => ({
  currency: 'BTC', resolution: 300, count: 200,
  candles: Array.from({ length: 200 }, (_, i) => ({ timestamp: i * 300_000, open: 100, high: 101, low: 99, close: 100 })),
}));
vi.mock('@lib/http', () => ({ fetchJson: (path: string) => fetchJson(path) }));

const { default: GexBandsChart } = await import('./GexBandsChart');

afterEach(() => { cleanup(); series.length = 0; vi.clearAllMocks(); });

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <GexBandsChart currency="BTC" gex={[]} spotPrice={100} showHistory={false} />
  </QueryClientProvider>);
}

describe('GexBandsChart ATR controls', () => {
  it('renders 60/3 without gamma history and switches to 130/4', async () => {
    mount();
    await waitFor(() => expect(series[1]?.setData).toHaveBeenLastCalledWith(expect.arrayContaining([{ time: 18_000, value: 106 }])));
    expect(fetchJson.mock.calls.every(([path]) => String(path).startsWith('/spot-candles'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '130 / 4' }));
    await waitFor(() => expect(series[1]?.setData).toHaveBeenLastCalledWith(expect.arrayContaining([{ time: 39_000, value: 108 }])));
    expect(series[2]?.setData).toHaveBeenLastCalledWith(expect.arrayContaining([{ time: 39_000, value: 92 }]));
  });

  it('keeps the last valid channel when an input is cleared or invalid', async () => {
    mount();
    const input = screen.getByLabelText('EMA / ATR length');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('60');
    fireEvent.change(screen.getByLabelText('ATR multiplier'), { target: { value: '-1' } });
    fireEvent.blur(screen.getByLabelText('ATR multiplier'));
    expect((screen.getByLabelText('ATR multiplier') as HTMLInputElement).value).toBe('3');
    await waitFor(() => expect(series[1]?.setData).toHaveBeenLastCalledWith(expect.arrayContaining([{ time: 18_000, value: 106 }])));
  });
});
