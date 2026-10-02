import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { InstrumentCandle, InstrumentMarkPoint } from '@oggregator/protocol';
import { priceFormatFromSeries } from './chart-precision.js';
import { buildEntryMarkers, type InstrumentEntry } from './entry-markers.js';
import styles from './InstrumentChart.module.css';

export interface InstrumentChartProps {
  candles: readonly InstrumentCandle[];
  markLine: readonly InstrumentMarkPoint[];
  overlays: { mark: boolean; ma9: boolean; ma20: boolean; entries?: boolean };
  entries?: readonly InstrumentEntry[];
  priceCurrency?: string | null;
  fallbackSpotUsd?: number | null;
  compact?: boolean;
}

const ENTRY_BUY_COLOR = '#38BDF8';
const ENTRY_SELL_COLOR = '#F472B6';
const NO_ENTRIES: readonly InstrumentEntry[] = [];

interface HoverOhlc { o: number; h: number; l: number; c: number }

function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export default function InstrumentChart({
  candles,
  markLine,
  overlays,
  entries = NO_ENTRIES,
  priceCurrency = null,
  fallbackSpotUsd = null,
  compact = false,
}: InstrumentChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const markSeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const ma9SeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const entryMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [hover, setHover] = useState<HoverOhlc | null>(null);

  // Chart lifecycle — mount once. compact changes are applied via applyOptions
  // in a separate effect so the renderer isn't rebuilt on every toggle.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9aa0a6',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#00E997',
      downColor: '#CB3855',
      wickUpColor: '#00E997',
      wickDownColor: '#CB3855',
      // Borders draw so synthetic (mark-derived) bars with flat o=h=l=c bodies
      // still show a 1px horizontal line at the mark level. Real candle borders
      // pick up borderUpColor/borderDownColor from the body color via the
      // per-bar overrides below.
      borderVisible: true,
      priceLineVisible: false,
    });
    entryMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, []);
    markSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#FBBF24',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma9SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#A855F7',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma20SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#FACC15',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chart.subscribeCrosshairMove((p) => {
      const series = candleSeriesRef.current;
      if (!p.time || !series) { setHover(null); return; }
      const data = p.seriesData.get(series);
      if (!data || !('open' in data)) { setHover(null); return; }
      setHover({
        o: data.open as number,
        h: data.high as number,
        l: data.low as number,
        c: data.close as number,
      });
    });

    return () => { chart.remove(); chartRef.current = null; entryMarkersRef.current = null; };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { visible: !compact } });
  }, [compact]);

  // Adaptive y-axis precision — sub-$1 option premiums and Deribit inverse
  // BTC/ETH quotes (~0.03 BTC) would otherwise round to the default 2-decimal
  // grid and collapse every move into the same horizontal line. Resolved
  // before the candle effect because the synthetic-bar epsilon depends on it.
  const priceFormat = useMemo(() => {
    const highs = candles.map((c) => c.h);
    const marks = markLine.map((m) => m.c);
    return priceFormatFromSeries(highs, marks);
  }, [candles, markLine]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const epsilon = priceFormat.minMove;
    series.setData(
      candles.map((c) => {
        // Synthetic bars (mark-derived, no trade activity) are usually flat
        // o=h=l=c, which renders as a 0-pixel-tall invisible candle. Nudge
        // h/l by one minMove so the gray wick draws as a visible 1-2px tick
        // at the mark price. Borders (enabled at the series level) ensure
        // the body's top/bottom edges still render even when height=0.
        const flat = c.synthetic && c.o === c.h && c.h === c.l && c.l === c.c;
        return {
          time: (c.ts / 1000) as Time,
          open: c.o,
          high: flat ? c.c + epsilon : c.h,
          low: flat ? c.c - epsilon : c.l,
          close: c.c,
          ...(c.synthetic
            ? { color: '#6b7280', wickColor: '#6b7280', borderColor: '#6b7280' }
            : {}),
        };
      }),
    );
  }, [candles, priceFormat.minMove]);

  useEffect(() => {
    const series = markSeriesRef.current;
    if (!series) return;
    if (!overlays.mark) { series.setData([]); return; }
    series.setData(markLine.map((m) => ({ time: (m.ts / 1000) as Time, value: m.c })));
  }, [markLine, overlays.mark]);

  const closes = useMemo(() => candles.map((c) => c.c), [candles]);
  const ma9 = useMemo(() => sma(closes, 9), [closes]);
  const ma20 = useMemo(() => sma(closes, 20), [closes]);

  useEffect(() => {
    const fmt = {
      type: 'price' as const,
      precision: priceFormat.precision,
      minMove: priceFormat.minMove,
    };
    candleSeriesRef.current?.applyOptions({ priceFormat: fmt });
    markSeriesRef.current?.applyOptions({ priceFormat: fmt });
    ma9SeriesRef.current?.applyOptions({ priceFormat: fmt });
    ma20SeriesRef.current?.applyOptions({ priceFormat: fmt });
  }, [priceFormat.precision, priceFormat.minMove]);

  useEffect(() => {
    const series = ma9SeriesRef.current;
    if (!series) return;
    if (!overlays.ma9) { series.setData([]); return; }
    series.setData(
      candles.flatMap((c, i) =>
        ma9[i] == null ? [] : [{ time: (c.ts / 1000) as Time, value: ma9[i] as number }],
      ),
    );
  }, [ma9, candles, overlays.ma9]);

  useEffect(() => {
    const series = ma20SeriesRef.current;
    if (!series) return;
    if (!overlays.ma20) { series.setData([]); return; }
    series.setData(
      candles.flatMap((c, i) =>
        ma20[i] == null ? [] : [{ time: (c.ts / 1000) as Time, value: ma20[i] as number }],
      ),
    );
  }, [ma20, candles, overlays.ma20]);

  const showEntries = overlays.entries !== false;
  const entryMarkers = useMemo(
    () => buildEntryMarkers(entries, candles, priceCurrency, fallbackSpotUsd, priceFormat.precision),
    [entries, candles, priceCurrency, fallbackSpotUsd, priceFormat.precision],
  );
  useEffect(() => {
    const plugin = entryMarkersRef.current;
    if (!plugin) return;
    if (!showEntries) { plugin.setMarkers([]); return; }
    plugin.setMarkers(
      entryMarkers.map((e): SeriesMarker<Time> => ({
        id: e.id,
        time: (e.barTs / 1000) as Time,
        position: e.side === 'buy' ? 'atPriceBottom' : 'atPriceTop',
        price: e.price,
        shape: e.side === 'buy' ? 'arrowUp' : 'arrowDown',
        color: e.side === 'buy' ? ENTRY_BUY_COLOR : ENTRY_SELL_COLOR,
        ...(compact ? {} : { text: e.text }),
      })),
    );
  }, [entryMarkers, showEntries, compact]);

  const last = candles.length > 0 ? candles[candles.length - 1]! : null;
  const displayOhlc = hover ?? (last ? { o: last.o, h: last.h, l: last.l, c: last.c } : null);

  return (
    <div className={styles.wrap}>
      {!compact && displayOhlc && (
        <div className={styles.ohlcStrip}>
          <span>O {displayOhlc.o.toFixed(priceFormat.precision)}</span>
          <span>H {displayOhlc.h.toFixed(priceFormat.precision)}</span>
          <span>L {displayOhlc.l.toFixed(priceFormat.precision)}</span>
          <span>C {displayOhlc.c.toFixed(priceFormat.precision)}</span>
        </div>
      )}
      <div ref={containerRef} className={styles.chart} />
    </div>
  );
}
