import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

import { fetchJson } from '@lib/http';
import type {
  SpotCandleCurrency,
  SpotCandleResolutionSec,
  SpotCandlesResponse,
} from '@shared/common';
import type { GexStrike } from '@shared/enriched';

import { GammaChannelPrimitive } from './GammaChannelPrimitive';
import { computeGammaWalls } from './gex-wall-utils';
import styles from './GexView.module.css';

type Timeframe = '1d' | '3d' | '7d' | '30d' | '90d';

interface TimeframeSpec {
  resolution: SpotCandleResolutionSec;
  buckets: number;
  windowSec: number;
}

const TIMEFRAMES: Record<Timeframe, TimeframeSpec> = {
  '1d': { resolution: 300, buckets: 864, windowSec: 86_400 },
  '3d': { resolution: 300, buckets: 2592, windowSec: 3 * 86_400 },
  '7d': { resolution: 1800, buckets: 1008, windowSec: 7 * 86_400 },
  '30d': { resolution: 3600, buckets: 2160, windowSec: 30 * 86_400 },
  '90d': { resolution: 14400, buckets: 1620, windowSec: 90 * 86_400 },
};
const DEFAULT_TIMEFRAME: Timeframe = '30d';

const CALL_WALL_COLOR = '#00E997';
const PUT_WALL_COLOR = '#CB3855';
const FLIP_COLOR = '#F0B90B';
const SPOT_COLOR = '#50D2C1';

function useGexSpotCandles(
  currency: SpotCandleCurrency,
  resolution: SpotCandleResolutionSec,
  buckets: number,
) {
  return useQuery({
    queryKey: ['spot-candles', currency, resolution, buckets],
    queryFn: () =>
      fetchJson<SpotCandlesResponse>(
        `/spot-candles?currency=${currency}&resolution=${resolution}&buckets=${buckets}`,
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: SpotCandlesResponse | undefined) => prev,
  });
}

interface WallLineOpts {
  color: string;
  label: string;
  dashed: boolean;
}

// Remove the old price line and draw the new one; null price clears it.
function syncWallLine(
  series: ISeriesApi<'Candlestick', Time>,
  ref: React.MutableRefObject<IPriceLine | null>,
  price: number | null,
  opts: WallLineOpts,
): void {
  if (ref.current) {
    series.removePriceLine(ref.current);
    ref.current = null;
  }
  if (price == null) return;
  ref.current = series.createPriceLine({
    price,
    color: opts.color,
    lineWidth: 2,
    lineStyle: opts.dashed ? LineStyle.Dashed : LineStyle.Solid,
    axisLabelVisible: true,
    title: `${Math.round(price).toLocaleString()} ${opts.label}`,
  });
}

interface Props {
  gex: GexStrike[];
  spotPrice: number | null;
  currency: SpotCandleCurrency;
}

export default function GexBandsChart({ gex, spotPrice, currency }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const channelRef = useRef<GammaChannelPrimitive | null>(null);
  const callLineRef = useRef<IPriceLine | null>(null);
  const putLineRef = useRef<IPriceLine | null>(null);
  const flipLineRef = useRef<IPriceLine | null>(null);
  const spotLineRef = useRef<IPriceLine | null>(null);
  const didFitRef = useRef(false);

  const tfSpec = TIMEFRAMES[timeframe];
  const {
    data: candleData,
    isLoading: candlesLoading,
    error: candlesError,
    refetch,
  } = useGexSpotCandles(currency, tfSpec.resolution, tfSpec.buckets);

  const walls = useMemo(() => computeGammaWalls(gex, spotPrice), [gex, spotPrice]);

  // Chart lifecycle (mount/unmount only).
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
      crosshair: {
        horzLine: { color: SPOT_COLOR, labelBackgroundColor: '#0E3333' },
        vertLine: { color: SPOT_COLOR, labelBackgroundColor: '#0E3333' },
      },
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

  // Re-fit the visible range when currency/timeframe changes.
  useEffect(() => {
    didFitRef.current = false;
  }, [currency, timeframe]);

  // Push candle data + set the visible range for the timeframe. The walls are
  // horizontal price lines, so no future whitespace is needed here.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !candleData) return;
    const data = candleData.candles.map((c) => ({
      time: Math.floor(c.timestamp / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);
    if (data.length === 0) return;
    if (!didFitRef.current) {
      const nowSec = Math.floor(Date.now() / 1000);
      chart.timeScale().setVisibleRange({
        from: (nowSec - tfSpec.windowSec) as Time,
        to: nowSec as Time,
      });
      didFitRef.current = true;
    }
  }, [candleData, tfSpec]);

  // Channel fill + the three wall/flip price lines.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    channelRef.current?.update(walls.callWall, walls.putWall);
    syncWallLine(series, callLineRef, walls.callWall, {
      color: CALL_WALL_COLOR,
      label: 'CALL WALL',
      dashed: false,
    });
    syncWallLine(series, putLineRef, walls.putWall, {
      color: PUT_WALL_COLOR,
      label: 'PUT WALL',
      dashed: false,
    });
    syncWallLine(series, flipLineRef, walls.gammaFlip, {
      color: FLIP_COLOR,
      label: 'FLIP',
      dashed: true,
    });
  }, [walls]);

  // SPOT line.
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
      <div className={styles.bandsControls}>
        <div className={styles.bandsToggle}>
          {(Object.keys(TIMEFRAMES) as Timeframe[]).map((tf) => (
            <button
              key={tf}
              type="button"
              className={styles.bandsTab}
              data-active={timeframe === tf || undefined}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.bandsChartWrap}>
        <div className={styles.bandsChartCanvas} ref={containerRef} />
        {candlesLoading && !candleData && (
          <div className={styles.bandsOverlay}>Loading spot history…</div>
        )}
        {candlesError && (
          <div className={styles.bandsOverlay}>
            <div>Spot history unavailable</div>
            <button type="button" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
