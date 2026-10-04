import {
  CALL_WALL_COLOR,
  computeGammaWalls,
  GammaBandsPrimitive,
  type GammaWalls,
  PUT_WALL_COLOR,
} from '@features/gex';
import gexStyles from '@features/gex/GexView.module.css';
import type { InstrumentCandleInterval, InstrumentCandleRange } from '@oggregator/protocol';
import type { GexStrike } from '@shared/enriched';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type Time,
} from 'lightweight-charts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { liveBarToCandle, tsToSec } from './live-candle';
import { useTradfiUnderlyingCandles } from './use-tradfi-underlying-candles';
import { useTradfiUnderlyingCandlesLive } from './use-tradfi-underlying-candles-live';

const SPOT_COLOR = '#50D2C1';
// Share of the candles reserved right of the last bar for the live walls.
const PROJECTION_FRACTION = 0.15;
const MIN_PROJECTION_BARS = 8;

// Range → interval mapping (both are protocol enums).
const RANGES: Array<{ range: InstrumentCandleRange; interval: InstrumentCandleInterval; label: string }> = [
  { range: '1d', interval: '5m', label: '1d' },
  { range: '7d', interval: '1h', label: '7d' },
  { range: '30d', interval: '4h', label: '30d' },
  { range: 'max', interval: '1d', label: 'max' },
];

interface Props {
  underlying: string;
  gex: GexStrike[];
  spotPrice: number | null;
}

export default function TradfiGexBandsChart({ underlying, gex, spotPrice }: Props) {
  const [rangeIdx, setRangeIdx] = useState(2); // default 30d
  const sel = RANGES[rangeIdx]!;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const bandsRef = useRef<GammaBandsPrimitive | null>(null);
  const wallsRef = useRef<GammaWalls>({ callWall: null, putWall: null, gammaFlip: null });
  const anchorRef = useRef<number | null>(null);
  const didFitRef = useRef(false);
  const spotLineRef = useRef<IPriceLine | null>(null);

  const { data, isLoading, error, refetch } = useTradfiUnderlyingCandles({
    underlying,
    interval: sel.interval,
    range: sel.range,
  });

  const walls = useMemo(() => computeGammaWalls(gex, spotPrice), [gex, spotPrice]);

  // Mount/unmount.
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
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: CALL_WALL_COLOR,
      downColor: PUT_WALL_COLOR,
      wickUpColor: CALL_WALL_COLOR,
      wickDownColor: PUT_WALL_COLOR,
      borderVisible: false,
      priceLineVisible: false,
    }) as ISeriesApi<'Candlestick', Time>;
    const bands = new GammaBandsPrimitive();
    series.attachPrimitive(bands);
    chartRef.current = chart;
    seriesRef.current = series;
    bandsRef.current = bands;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      bandsRef.current = null;
      spotLineRef.current = null;
    };
  }, []);

  const pushBands = useCallback(() => {
    bandsRef.current?.update([], wallsRef.current, anchorRef.current);
  }, []);

  useEffect(() => {
    didFitRef.current = false;
  }, [underlying, rangeIdx]);

  // Candle data, plus empty space right of the last bar for the live walls.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !data) return;
    const candles = data.candles.map((c) => ({
      time: tsToSec(c.ts) as Time,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));
    series.setData(candles);
    anchorRef.current = candles.length > 0 ? (candles[candles.length - 1]!.time as number) : null;
    pushBands();
    if (candles.length === 0 || didFitRef.current) return;
    const last = candles.length - 1;
    chart.timeScale().setVisibleLogicalRange({
      from: 0,
      to: last + Math.max(MIN_PROJECTION_BARS, Math.round(candles.length * PROJECTION_FRACTION)),
    });
    didFitRef.current = true;
  }, [data, pushBands]);

  useEffect(() => {
    wallsRef.current = walls;
    pushBands();
  }, [walls, pushBands]);

  const applySpotLine = useCallback((price: number | null) => {
    const series = seriesRef.current;
    if (!series) return;
    if (spotLineRef.current) {
      series.removePriceLine(spotLineRef.current);
      spotLineRef.current = null;
    }
    if (price != null) {
      spotLineRef.current = series.createPriceLine({
        price,
        color: SPOT_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(price).toLocaleString()} SPOT`,
      });
    }
  }, []);

  useEffect(() => {
    applySpotLine(spotPrice);
  }, [spotPrice, applySpotLine]);

  // Live tail: merge the forming bar (lightweight-charts updates-or-appends by
  // time) and let the spot line ride the live close. REST history above is the
  // first paint + fallback; walls/GEX stay on the 5s poll.
  const handleLiveBar = useCallback(
    (bar: { ts: number; o: number; h: number; l: number; c: number; vol: number }) => {
      const series = seriesRef.current;
      if (!series) return;
      const candle = liveBarToCandle(bar);
      series.update(candle);
      if (anchorRef.current === null || (candle.time as number) > anchorRef.current) {
        anchorRef.current = candle.time as number;
        pushBands();
      }
      applySpotLine(bar.c);
    },
    [applySpotLine, pushBands],
  );

  useTradfiUnderlyingCandlesLive({ underlying, interval: sel.interval, onBar: handleLiveBar });

  return (
    <div>
      <div className={gexStyles.bandsControls}>
        <div className={gexStyles.bandsToggle}>
          {RANGES.map((r, i) => (
            <button
              key={r.range}
              type="button"
              className={gexStyles.bandsTab}
              data-active={i === rangeIdx || undefined}
              onClick={() => setRangeIdx(i)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className={gexStyles.bandsChartWrap}>
        <div className={gexStyles.bandsChartCanvas} ref={containerRef} />
        {isLoading && !data && <div className={gexStyles.bandsOverlay}>Loading underlying history…</div>}
        {error && (
          <div className={gexStyles.bandsOverlay}>
            <div>Underlying history unavailable</div>
            <button type="button" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
