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
import type { GexWallHistoryResponse } from '@oggregator/protocol';

import { CALL_WALL_COLOR, GammaBandsPrimitive, PUT_WALL_COLOR } from './GammaBandsPrimitive';
import { alignWallHistory, smoothWallHistory } from './gex-wall-history';
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

const SPOT_COLOR = '#50D2C1';
// Share of the visible window reserved right of the last candle for the live walls.
const PROJECTION_FRACTION = 0.15;
const MIN_PROJECTION_BARS = 8;
// SMA window for the recorded walls, fixed in time so every timeframe smooths
// over the same span regardless of candle size.
const WALL_SMA_WINDOW_SEC = 6 * 3600;

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

// Recorded walls are all-expiry, all-venue snapshots, so callers only enable
// this when the live walls are computed on the same basis.
function useGexWallHistory(currency: SpotCandleCurrency, days: number, enabled: boolean) {
  return useQuery({
    queryKey: ['gex-wall-history', currency, days],
    queryFn: () =>
      fetchJson<GexWallHistoryResponse>(`/gex-wall-history?underlying=${currency}&days=${days}`),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

interface Props {
  gex: GexStrike[];
  spotPrice: number | null;
  currency: SpotCandleCurrency;
  showHistory: boolean;
}

export default function GexBandsChart({ gex, spotPrice, currency, showHistory }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const bandsRef = useRef<GammaBandsPrimitive | null>(null);
  const spotLineRef = useRef<IPriceLine | null>(null);
  const didFitRef = useRef(false);

  const tfSpec = TIMEFRAMES[timeframe];
  const {
    data: candleData,
    isLoading: candlesLoading,
    isPlaceholderData: candlesStale,
    error: candlesError,
    refetch,
  } = useGexSpotCandles(currency, tfSpec.resolution, tfSpec.buckets);

  const walls = useMemo(() => computeGammaWalls(gex, spotPrice), [gex, spotPrice]);

  const { data: historyData } = useGexWallHistory(
    currency,
    Math.ceil(tfSpec.windowSec / 86_400),
    showHistory,
  );

  const candleTimes = useMemo(
    () => (candleData?.candles ?? []).map((c) => Math.floor(c.timestamp / 1000)),
    [candleData],
  );
  const history = useMemo(
    () =>
      showHistory && historyData && !candlesStale
        ? smoothWallHistory(
            alignWallHistory(candleTimes, historyData.points, tfSpec.resolution),
            Math.max(1, Math.round(WALL_SMA_WINDOW_SEC / tfSpec.resolution)),
            tfSpec.resolution,
          )
        : [],
    [showHistory, historyData, candlesStale, candleTimes, tfSpec.resolution],
  );

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

  // Re-fit the visible range when currency/timeframe changes.
  useEffect(() => {
    didFitRef.current = false;
  }, [currency, timeframe]);

  // Push candle data + set the visible range for the timeframe, leaving empty
  // space right of the last candle for the live-wall projection.
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
    // Placeholder bars belong to the previous timeframe; fitting logical
    // indexes to them leaves the new data scrolled off-screen.
    if (data.length === 0 || candlesStale) return;
    if (!didFitRef.current) {
      const last = data.length - 1;
      const windowBars = Math.min(last, Math.round(tfSpec.windowSec / tfSpec.resolution));
      const projectionBars = Math.max(
        MIN_PROJECTION_BARS,
        Math.round(windowBars * PROJECTION_FRACTION),
      );
      chart.timeScale().setVisibleLogicalRange({
        from: last - windowBars,
        to: last + projectionBars,
      });
      didFitRef.current = true;
    }
  }, [candleData, candlesStale, tfSpec]);

  useEffect(() => {
    const anchor = candleTimes.length > 0 ? candleTimes[candleTimes.length - 1]! : null;
    bandsRef.current?.update(history, walls, anchor);
  }, [history, walls, candleTimes]);

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
        <span className={styles.bandsNote}>
          {showHistory
            ? 'Band history: recorded walls · dashed zone: live walls'
            : 'Dashed zone: live walls · band history needs ALL expiries + all venues'}
        </span>
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
