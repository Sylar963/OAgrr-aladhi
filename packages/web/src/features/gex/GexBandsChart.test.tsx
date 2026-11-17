import type { GexProfilePoint } from '@shared/enriched';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const makeSeries = () => ({
  setData: vi.fn(),
  applyOptions: vi.fn(),
  attachPrimitive: vi.fn(),
  createPriceLine: vi.fn(() => ({})),
  removePriceLine: vi.fn(),
  coordinateToPrice: (y: number) => y,
});
const series: ReturnType<typeof makeSeries>[] = [];
const heatmapUpdate = vi.fn();
let crosshair: ((event: { point?: { x: number; y: number } }) => void) | undefined;
let click: typeof crosshair;
vi.mock('lightweight-charts', () => ({
  CandlestickSeries: {},
  LineSeries: {},
  ColorType: { Solid: 'solid' },
  LineStyle: { Solid: 0 },
  createChart: () => ({
    addSeries: () => {
      const s = makeSeries();
      series.push(s);
      return s;
    },
    remove: () => {},
    timeScale: () => ({ setVisibleLogicalRange: () => {}, timeToCoordinate: () => 100 }),
    subscribeCrosshairMove: (handler: typeof crosshair) => {
      crosshair = handler;
    },
    unsubscribeCrosshairMove: () => {
      crosshair = undefined;
    },
    subscribeClick: (handler: typeof click) => {
      click = handler;
    },
    unsubscribeClick: () => {
      click = undefined;
    },
  }),
}));
vi.mock('./GammaBandsPrimitive', () => ({
  CALL_WALL_COLOR: '#00E997',
  PUT_WALL_COLOR: '#CB3855',
  GammaBandsPrimitive: class {
    update() {}
    setLabels() {}
    setHeatmap(value: unknown) {
      heatmapUpdate(value);
    }
  },
}));
const fetchJson = vi.fn(async (_path: string) => ({
  currency: 'BTC',
  resolution: 300,
  count: 200,
  candles: Array.from({ length: 200 }, (_, i) => ({
    timestamp: i * 300_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  })),
}));
vi.mock('@lib/http', () => ({ fetchJson: (path: string) => fetchJson(path) }));

vi.mock('@hooks/useLiveSpotOverlay', () => ({ useLiveSpotOverlay: () => {} }));

const { default: GexBandsChart } = await import('./GexBandsChart');

afterEach(() => {
  cleanup();
  series.length = 0;
  vi.clearAllMocks();
});

function mount(gexProfile?: GexProfilePoint[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GexBandsChart currency="BTC" gex={[]} gexProfile={gexProfile} spotPrice={100} />
    </QueryClientProvider>,
  );
}

describe('GexBandsChart ATR controls', () => {
  it('renders 60/3 without gamma history and switches to 130/4', async () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Gamma history' })).toBeNull();
    expect(screen.getByText('ATR channel')).toBeTruthy();
    await waitFor(() =>
      expect(series[1]?.setData).toHaveBeenLastCalledWith(
        expect.arrayContaining([{ time: 18_000, value: 106 }]),
      ),
    );
    expect(fetchJson.mock.calls.every(([path]) => String(path).startsWith('/spot-candles'))).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '130 / 4' }));
    await waitFor(() =>
      expect(series[1]?.setData).toHaveBeenLastCalledWith(
        expect.arrayContaining([{ time: 39_000, value: 108 }]),
      ),
    );
    expect(series[2]?.setData).toHaveBeenLastCalledWith(
      expect.arrayContaining([{ time: 39_000, value: 92 }]),
    );
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
    await waitFor(() =>
      expect(series[1]?.setData).toHaveBeenLastCalledWith(
        expect.arrayContaining([{ time: 18_000, value: 106 }]),
      ),
    );
  });
});

describe('GEX heatmap controls', () => {
  const profile = [
    { movePct: -0.2, gexUsdMillions: -10 },
    { movePct: 0, gexUsdMillions: 0 },
    { movePct: 0.2, gexUsdMillions: 5 },
  ];

  it('defaults to heatmap and keeps a shared magnitude scale when opacity changes', async () => {
    mount(profile);
    expect(screen.getByRole('button', { name: 'Heatmap' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await waitFor(() =>
      expect(heatmapUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ maxMagnitude: 10, opacity: 0.65 }),
      ),
    );
    fireEvent.change(screen.getByRole('slider', { name: 'Heatmap opacity' }), {
      target: { value: '40' },
    });
    expect(heatmapUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxMagnitude: 10, opacity: 0.4 }),
    );
    expect(screen.getByText('-10.0M')).toBeTruthy();
    expect(screen.getByText('+10.0M')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Levels' }));
    expect(heatmapUpdate).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Heatmap' }));
    expect(heatmapUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ opacity: 0.4 }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Live gamma levels' }));
    expect(heatmapUpdate).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText('Net GEX · $M / 1% move')).toBeNull();
  });

  it('does not synthesize a surface from walls when the profile is missing', async () => {
    mount();
    expect(screen.getByText('Gamma profile unavailable · showing levels only')).toBeTruthy();
    await waitFor(() =>
      expect(heatmapUpdate).toHaveBeenLastCalledWith({
        points: [],
        maxMagnitude: 0,
        opacity: 0.65,
        profileOutline: true,
      }),
    );
  });

  it('toggles the profile outline while retaining heatmap magnitudes and opacity', async () => {
    mount(profile);
    const checkbox = screen.getByRole('checkbox', { name: 'Profile outline' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await waitFor(() =>
      expect(heatmapUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          maxMagnitude: 10,
          opacity: 0.65,
          profileOutline: true,
        }),
      ),
    );
    fireEvent.click(checkbox);
    expect(heatmapUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        maxMagnitude: 10,
        opacity: 0.65,
        profileOutline: false,
      }),
    );
    expect(screen.queryByText(/Outline: farther left/)).toBeNull();
    fireEvent.click(checkbox);
    expect(screen.getByText(/Outline: farther left/)).toBeTruthy();
  });

  it('reports gamma only inside the live heatmap and its modeled price range', async () => {
    mount(profile);
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await waitFor(() => {
      act(() => crosshair?.({ point: { x: 110, y: 90 } }));
      expect(screen.getByText('Net Γ at 90: -5.0M')).toBeTruthy();
    });
    act(() => crosshair?.({ point: { x: 50, y: 90 } }));
    expect(screen.queryByText('Net Γ at 90: -5.0M')).toBeNull();
    act(() => crosshair?.({ point: { x: 110, y: 150 } }));
    expect(screen.getByText('Hover or tap the heatmap to inspect gamma at a price')).toBeTruthy();
    act(() => crosshair?.({}));
    expect(screen.queryByText(/Net Γ at/)).toBeNull();
    act(() => click?.({ point: { x: 110, y: 110 } }));
    expect(screen.getByText('Net Γ at 110: +2.5M')).toBeTruthy();
  });
});
