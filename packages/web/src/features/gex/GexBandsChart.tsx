import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  LineSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { z } from 'zod';

import { fetchJson } from '@lib/http';
import { defineMessages, useT } from '@lib/i18n';
import type {
  SpotCandleCurrency,
  SpotCandleResolutionSec,
  SpotCandlesResponse,
} from '@shared/common';
import type { GexProfilePoint, GexStrike } from '@shared/enriched';
import type { GexWallHistoryResponse } from '@oggregator/protocol';

import { CALL_WALL_COLOR, GammaBandsPrimitive, PUT_WALL_COLOR } from './GammaBandsPrimitive';
import { alignWallHistory, gexKeltner } from './gex-wall-history';
import { computeGammaWalls } from './gex-wall-utils';
import { atrChannel } from './atr-channel';
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
const DEFAULT_TIMEFRAME: Timeframe = '3d';
const EMPTY_WALLS = { callWall: null, putWall: null, gammaFlip: null };
const CandleResponseSchema = z.object({
  currency: z.enum(['BTC', 'ETH', 'HYPE']),
  resolution: z.union([z.literal(60), z.literal(300), z.literal(900), z.literal(1800), z.literal(3600), z.literal(14400), z.literal(86400)]),
  count: z.number().int().nonnegative(),
  candles: z.array(z.object({
    timestamp: z.number().int(),
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
  }).refine(c => c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close))),
});

const SPOT_COLOR = '#50D2C1';
// Share of the visible window reserved right of the last candle for the live walls.
const PROJECTION_FRACTION = 0.15;
const MIN_PROJECTION_BARS = 8;
// Counted in candles, like a chart-platform Keltner length.
const KELTNER_LENGTH = 130;

function useGexSpotCandles(
  currency: SpotCandleCurrency,
  resolution: SpotCandleResolutionSec,
  buckets: number,
) {
  return useQuery({
    queryKey: ['spot-candles', currency, resolution, buckets],
    queryFn: async () =>
      CandleResponseSchema.parse(await fetchJson<unknown>(
        `/spot-candles?currency=${currency}&resolution=${resolution}&buckets=${buckets}`,
      )),
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

const messages = defineMessages(
  {
    callWall: 'POSITIVE Γ ABOVE',
    putWall: 'NEGATIVE Γ BELOW',
    flip: 'FLIP',
    noteHistory: 'GEX Keltner 130: EMA ± smoothed wall distance · dashed zone: live walls',
    noteLive: 'Dashed zone: live walls · band history needs ALL expiries + all venues',
    loading: 'Loading spot history…',
    unavailable: 'Spot history unavailable',
    retry: 'Retry',
    atrChannel: 'ATR channel',
    gammaHistory: 'Gamma history',
    length: 'EMA / ATR length',
    multiplier: 'ATR multiplier',
    gammaOverlay: 'Live gamma levels',
    noteAtr: 'EMA {length} ± {multiplier} × Wilder ATR {length} · {interval} candles · fixed from previous close',
  },
  {
    callWall: 'Γ POSITIVO ARRIBA',
    putWall: 'Γ NEGATIVO ABAJO',
    flip: 'FLIP',
    noteHistory:
      'Keltner GEX 130: EMA ± distancia suavizada a los muros · zona punteada: muros en vivo',
    noteLive:
      'Zona punteada: muros en vivo · el historial de bandas requiere TODOS los vencimientos + todos los exchanges',
    loading: 'Cargando historial del spot…',
    unavailable: 'Historial del spot no disponible',
    retry: 'Reintentar',
    atrChannel: 'Canal ATR',
    gammaHistory: 'Historial gamma',
    length: 'Períodos EMA / ATR',
    multiplier: 'Multiplicador ATR',
    gammaOverlay: 'Niveles gamma en vivo',
    noteAtr: 'EMA {length} ± {multiplier} × ATR Wilder {length} · velas {interval} · fijado al cierre anterior',
  },
);

interface Props {
  gex: GexStrike[];
  gexProfile?: GexProfilePoint[];
  spotPrice: number | null;
  currency: SpotCandleCurrency;
  showHistory: boolean;
}

export default function GexBandsChart({
  gex,
  gexProfile,
  spotPrice,
  currency,
  showHistory,
}: Props) {
  const t = useT(messages);
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TIMEFRAME);
  const [mode, setMode] = useState<'atr' | 'gamma'>('atr');
  const [length, setLength] = useState(60);
  const [multiplier, setMultiplier] = useState(3);
  const [draftLength, setDraftLength] = useState('60');
  const [draftMultiplier, setDraftMultiplier] = useState('3');
  const [gammaOverlay, setGammaOverlay] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const bandsRef = useRef<GammaBandsPrimitive | null>(null);
  const atrSeriesRef = useRef<Record<'basis' | 'upper' | 'lower', ISeriesApi<'Line', Time>> | null>(null);
  const spotLineRef = useRef<IPriceLine | null>(null);
  const didFitRef = useRef(false);

  const tfSpec = TIMEFRAMES[timeframe];
  const buckets = Math.min(3000, Math.max(tfSpec.buckets, Math.ceil(tfSpec.windowSec / tfSpec.resolution) + length * 5));
  const {
    data: candleData,
    isLoading: candlesLoading,
    isPlaceholderData: candlesStale,
    error: candlesError,
    refetch,
  } = useGexSpotCandles(currency, tfSpec.resolution, buckets);

  const walls = useMemo(
    () => computeGammaWalls(gex, spotPrice, gexProfile),
    [gex, spotPrice, gexProfile],
  );

  const { data: historyData } = useGexWallHistory(
    currency,
    Math.ceil(tfSpec.windowSec / 86_400),
    showHistory && mode === 'gamma',
  );

  const candleCloses = useMemo(
    () =>
      (candleData?.candles ?? []).map((c) => ({
        time: Math.floor(c.timestamp / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    [candleData],
  );
  const candleTimes = useMemo(() => candleCloses.map((c) => c.time), [candleCloses]);
  const volatilityChannel = useMemo(
    () => candlesStale ? [] : atrChannel(candleCloses, length, multiplier, tfSpec.resolution),
    [candlesStale, candleCloses, length, multiplier, tfSpec.resolution],
  );
  const history = useMemo(
    () =>
      showHistory && historyData && !candlesStale
        ? gexKeltner(
            candleCloses,
            alignWallHistory(candleTimes, historyData.points, tfSpec.resolution),
            KELTNER_LENGTH,
          )
        : [],
    [showHistory, historyData, candlesStale, candleCloses, candleTimes, tfSpec.resolution],
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
    const lineOptions = { lineWidth: 2 as const, priceLineVisible: false, crosshairMarkerVisible: true };
    atrSeriesRef.current = {
      upper: chart.addSeries(LineSeries, { ...lineOptions, color: CALL_WALL_COLOR }),
      lower: chart.addSeries(LineSeries, { ...lineOptions, color: PUT_WALL_COLOR }),
      basis: chart.addSeries(LineSeries, { ...lineOptions, color: '#9aa0a6', lineWidth: 1 }),
    };

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      bandsRef.current = null;
      atrSeriesRef.current = null;
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
    bandsRef.current?.update(mode === 'gamma' ? history : [], gammaOverlay ? walls : EMPTY_WALLS, anchor);
    const series = atrSeriesRef.current;
    if (!series) return;
    for (const key of ['basis', 'upper', 'lower'] as const) {
      series[key].applyOptions({ visible: mode === 'atr' });
      series[key].setData(mode === 'atr' ? volatilityChannel.map(point => point[key] == null
        ? { time: point.time as Time }
        : { time: point.time as Time, value: point[key] }) : []);
    }
  }, [history, walls, candleTimes, mode, gammaOverlay, volatilityChannel]);

  useEffect(() => {
    bandsRef.current?.setLabels({
      callWall: t('callWall'),
      putWall: t('putWall'),
      gammaFlip: t('flip'),
    });
  }, [t]);

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
          {(['atr', 'gamma'] as const).map(value => (
            <button key={value} type="button" className={styles.bandsTab}
              data-active={mode === value || undefined} aria-pressed={mode === value}
              onClick={() => setMode(value)}>
              {t(value === 'atr' ? 'atrChannel' : 'gammaHistory')}
            </button>
          ))}
        </div>
        {mode === 'atr' && <>
          <label className={styles.bandsField}>
            {t('length')}
            <input type="number" min={2} max={250} step={1} value={draftLength}
              onChange={event => {
                setDraftLength(event.target.value);
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 2 && value <= 250) setLength(value);
              }} onBlur={() => setDraftLength(String(length))} />
          </label>
          <label className={styles.bandsField}>
            {t('multiplier')}
            <input type="number" min={0.5} max={10} step={0.25} value={draftMultiplier}
              onChange={event => {
                setDraftMultiplier(event.target.value);
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 0.5 && value <= 10) setMultiplier(value);
              }} onBlur={() => setDraftMultiplier(String(multiplier))} />
          </label>
          <div className={styles.bandsToggle}>
            {([[60, 3], [130, 4]] as const).map(([period, factor]) => (
              <button key={`${period}/${factor}`} type="button" className={styles.bandsTab}
                data-active={length === period && multiplier === factor || undefined}
                onClick={() => {
                  setLength(period); setDraftLength(String(period));
                  setMultiplier(factor); setDraftMultiplier(String(factor));
                }}>{period} / {factor}</button>
            ))}
          </div>
        </>}
        <label className={styles.bandsField}>
          <input type="checkbox" checked={gammaOverlay} onChange={event => setGammaOverlay(event.target.checked)} />
          {t('gammaOverlay')}
        </label>
      </div>
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
          {mode === 'atr'
            ? t('noteAtr', { length, multiplier, interval: tfSpec.resolution < 3600 ? `${tfSpec.resolution / 60}m` : `${tfSpec.resolution / 3600}h` })
            : showHistory ? t('noteHistory') : t('noteLive')}
        </span>
      </div>

      <div className={styles.bandsChartWrap}>
        <div className={styles.bandsChartCanvas} ref={containerRef} />
        {candlesLoading && !candleData && (
          <div className={styles.bandsOverlay}>{t('loading')}</div>
        )}
        {candlesError && (
          <div className={styles.bandsOverlay}>
            <div>{t('unavailable')}</div>
            <button type="button" onClick={() => void refetch()}>
              {t('retry')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
