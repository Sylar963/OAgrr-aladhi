import { computeGammaWalls, GammaChannelPrimitive } from '@features/gex';
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTradfiUnderlyingCandles } from './use-tradfi-underlying-candles';

const CALL_WALL_COLOR = '#00E997';
const PUT_WALL_COLOR = '#CB3855';
const FLIP_COLOR = '#F0B90B';
const SPOT_COLOR = '#50D2C1';

// Range → interval mapping (both are protocol enums).
const RANGES: Array<{ range: InstrumentCandleRange; interval: InstrumentCandleInterval; label: string }> = [
  { range: '1d', interval: '5m', label: '1d' },
  { range: '7d', interval: '1h', label: '7d' },
  { range: '30d', interval: '4h', label: '30d' },
  { range: 'max', interval: '1d', label: 'max' },
];

function tsToSec(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

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
  const channelRef = useRef<GammaChannelPrimitive | null>(null);
  const callLineRef = useRef<IPriceLine | null>(null);
  const putLineRef = useRef<IPriceLine | null>(null);
  const flipLineRef = useRef<IPriceLine | null>(null);
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
    const channel = new GammaChannelPrimitive();
    series.attachPrimitive(channel);
    chartRef.current = chart;
    seriesRef.current = series;
    channelRef.current = channel;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      channelRef.current = null;
      callLineRef.current = null;
      putLineRef.current = null;
      flipLineRef.current = null;
      spotLineRef.current = null;
    };
  }, []);

  // Candle data.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !data) return;
    series.setData(
      data.candles.map((c) => ({
        time: tsToSec(c.ts) as Time,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      })),
    );
  }, [data]);

  // Walls.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    channelRef.current?.update(walls.callWall, walls.putWall);
    const sync = (
      ref: React.MutableRefObject<IPriceLine | null>,
      price: number | null,
      color: string,
      label: string,
      dashed: boolean,
    ) => {
      if (ref.current) {
        series.removePriceLine(ref.current);
        ref.current = null;
      }
      if (price == null) return;
      ref.current = series.createPriceLine({
        price,
        color,
        lineWidth: 2,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(price).toLocaleString()} ${label}`,
      });
    };
    sync(callLineRef, walls.callWall, CALL_WALL_COLOR, 'CALL WALL', false);
    sync(putLineRef, walls.putWall, PUT_WALL_COLOR, 'PUT WALL', false);
    sync(flipLineRef, walls.gammaFlip, FLIP_COLOR, 'FLIP', true);
  }, [walls]);

  // Spot line.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (spotLineRef.current) {
      series.removePriceLine(spotLineRef.current);
      spotLineRef.current = null;
    }
    if (spotPrice != null) {
      spotLineRef.current = series.createPriceLine({
        price: spotPrice,
        color: SPOT_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(spotPrice).toLocaleString()} SPOT`,
      });
    }
  }, [spotPrice]);

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
