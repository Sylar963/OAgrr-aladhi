import { describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { formatBarCountdown, LiveSpotOverlay, secondsToBarClose } from './live-spot-overlay';

function build(futureWhitespace = false) {
  const volume = { setData: vi.fn(), update: vi.fn() };
  const series = {
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    update: vi.fn(),
  };
  const chart = {
    addSeries: vi.fn(() => volume),
    removeSeries: vi.fn(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
  };
  const overlay = new LiveSpotOverlay(
    chart as unknown as IChartApi,
    series as unknown as ISeriesApi<'Candlestick', Time>,
    60,
    futureWhitespace,
  );
  return { overlay, series, chart, volume };
}

const candle = (timestamp: number, close = 100, volume?: number) => ({
  timestamp,
  open: 100,
  high: Math.max(100, close),
  low: Math.min(100, close),
  close,
  ...(volume == null ? {} : { volume }),
});

describe('secondsToBarClose', () => {
  it('counts down to the next bucket boundary', () => {
    expect(secondsToBarClose(60, 60_000)).toBe(60);
    expect(secondsToBarClose(60, 90_000)).toBe(30);
    expect(secondsToBarClose(60, 119_500)).toBe(0);
  });

  it('closes daily bars at UTC midnight', () => {
    expect(secondsToBarClose(86_400, Date.UTC(2026, 10, 2, 23, 0, 0))).toBe(3600);
  });
});

describe('formatBarCountdown', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatBarCountdown(0)).toBe('00:00');
    expect(formatBarCountdown(65)).toBe('01:05');
  });

  it('keeps seconds ticking on long bars', () => {
    expect(formatBarCountdown(3 * 3600 + 7 * 60 + 12)).toBe('03:07:12');
  });
});

describe('LiveSpotOverlay', () => {
  it('draws volume only for candles that have it', () => {
    const { overlay, volume } = build();
    overlay.setHistory([candle(60_000, 101, 5), candle(120_000, 99)]);
    expect(volume.setData).toHaveBeenCalledWith([
      expect.objectContaining({ time: 60, value: 5 }),
    ]);
  });

  it('colours volume by candle direction', () => {
    const { overlay, volume } = build();
    overlay.setHistory([candle(60_000, 101, 1), candle(120_000, 99, 1)]);
    const [up, down] = volume.setData.mock.calls[0]![0] as { color: string }[];
    expect(up!.color).not.toBe(down!.color);
  });

  it('updates the forming bar in seconds with its volume', () => {
    const { overlay, series, volume } = build();
    overlay.setHistory([candle(60_000, 100, 1)]);
    overlay.applyBar(candle(120_000, 105, 3));
    expect(series.update).toHaveBeenCalledWith(
      { time: 120, open: 100, high: 105, low: 100, close: 105 },
      false,
    );
    expect(volume.update).toHaveBeenCalledWith(expect.objectContaining({ time: 120, value: 3 }), false);
  });

  it('applies the just-closed bucket as a historical update', () => {
    const { overlay, series } = build();
    overlay.setHistory([candle(120_000, 100, 1)]);
    overlay.applyBar(candle(60_000, 105, 3));
    expect(series.update).toHaveBeenCalledWith(expect.objectContaining({ time: 60 }), true);
  });

  it('always updates historically on charts with whitespace after the last bar', () => {
    const { overlay, series } = build(true);
    overlay.setHistory([candle(60_000, 100, 1)]);
    overlay.applyBar(candle(120_000, 105, 3));
    expect(series.update).toHaveBeenCalledWith(expect.objectContaining({ time: 120 }), true);
  });

  it('survives the chart rejecting a bar', () => {
    const { overlay, series } = build();
    series.update.mockImplementation(() => {
      throw new Error('Cannot update oldest data');
    });
    expect(() => overlay.applyBar(candle(60_000))).not.toThrow();
  });

  it('removes its series only while the chart is alive', () => {
    const removed = build();
    removed.overlay.dispose(false);
    expect(removed.chart.removeSeries).not.toHaveBeenCalled();

    const alive = build();
    alive.overlay.dispose(true);
    expect(alive.chart.removeSeries).toHaveBeenCalled();
    expect(alive.series.detachPrimitive).toHaveBeenCalled();
  });
});
