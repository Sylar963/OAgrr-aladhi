import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

import { chainKeys } from '@features/chain';
import { fetchJson } from '@lib/http';
import { formatExpiry } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import type { SpotCandleResolutionSec, SpotCandlesResponse } from '@shared/common';
import type { EnrichedChainResponse } from '@shared/enriched';

import {
  BE_TENOR_TARGETS,
  atmStraddleBreakevens,
  deltaStrangleBreakevens,
  otmStrangleBreakevens,
  pickNearestExpiry,
  type BeTenorTarget,
  type ExpiryCandidate,
  type StructureBreakevens,
} from './breakeven-levels';
import styles from './BreakevenTaChart.module.css';

export const TA_UNDERLYINGS = ['BTC', 'ETH'] as const;
export type TaUnderlying = (typeof TA_UNDERLYINGS)[number];

type Timeframe = '7d' | '30d' | '90d' | '180d';
const TIMEFRAMES: Record<Timeframe, { resolution: SpotCandleResolutionSec; buckets: number }> = {
  '7d': { resolution: 1800, buckets: 336 },
  '30d': { resolution: 3600, buckets: 720 },
  '90d': { resolution: 14400, buckets: 540 },
  '180d': { resolution: 86400, buckets: 180 },
};

type LineKey = 'atm0' | 'otm0' | 'atm15' | 'otm15' | 'atm30' | 'otm30' | 'portfolio';

interface LineSpec {
  key: LineKey;
  label: string;
  color: string;
  style: LineStyle;
}

const LINE_SPECS: LineSpec[] = [
  { key: 'atm0', label: '0DTE ATM straddle', color: '#f472b6', style: LineStyle.Solid },
  { key: 'otm0', label: '0DTE 25Δ strangle', color: '#2dd4bf', style: LineStyle.Solid },
  { key: 'atm15', label: '15d ATM straddle', color: '#a78bfa', style: LineStyle.Solid },
  { key: 'otm15', label: '15d 25% OTM strangle', color: '#38bdf8', style: LineStyle.Solid },
  { key: 'atm30', label: '30d ATM straddle', color: '#c4b5fd', style: LineStyle.Dashed },
  { key: 'otm30', label: '30d 25% OTM strangle', color: '#7dd3fc', style: LineStyle.Dashed },
  { key: 'portfolio', label: 'Portfolio BE', color: '#fbbf24', style: LineStyle.Dotted },
];

const messages = defineMessages(
  {
    atm0: '0DTE ATM straddle',
    otm0: '0DTE 25Δ strangle',
    atm15: '15d ATM straddle',
    otm15: '15d 25% OTM strangle',
    atm30: '30d ATM straddle',
    otm30: '30d 25% OTM strangle',
    portfolio: 'Portfolio BE',
    bookIs: 'book is {u}',
    noBe: 'no BE',
    loading: 'loading…',
    unavailable: 'unavailable',
    taUnderlying: 'TA underlying',
    candleRange: 'Candle range',
    beSnapshot: 'BE snapshot {time}',
    beSnapshotEmpty: 'BE snapshot —',
    refSpot: ' · ref spot {v}',
    refreshing: 'Refreshing…',
    refreshSnapshot: 'Refresh snapshot',
    loadingSpot: 'Loading {u} spot history…',
    spotUnavailable: 'Spot history unavailable',
    retry: 'Retry',
    expiriesUnavailable: 'Expiries unavailable, so structure break-evens cannot be computed.',
    hint: 'Break-evens are a frozen snapshot from the front (0DTE) expiry and the listed expiries nearest 15d and 30d, priced at the median venue mid. ATM: strike ± straddle cost. Strangles: put strike − cost and call strike + cost, using strikes nearest 25% from spot (15d/30d) or nearest 25Δ by median venue delta (0DTE). Candles: Deribit perpetual.',
  },
  {
    atm0: '0DTE straddle ATM',
    otm0: '0DTE strangle 25Δ',
    atm15: '15d straddle ATM',
    otm15: '15d strangle 25% OTM',
    atm30: '30d straddle ATM',
    otm30: '30d strangle 25% OTM',
    portfolio: 'BE del portafolio',
    bookIs: 'el libro es {u}',
    noBe: 'sin BE',
    loading: 'cargando…',
    unavailable: 'no disponible',
    taUnderlying: 'Subyacente TA',
    candleRange: 'Rango de velas',
    beSnapshot: 'Snapshot BE {time}',
    beSnapshotEmpty: 'Snapshot BE —',
    refSpot: ' · spot ref. {v}',
    refreshing: 'Actualizando…',
    refreshSnapshot: 'Actualizar snapshot',
    loadingSpot: 'Cargando historial spot de {u}…',
    spotUnavailable: 'Historial spot no disponible',
    retry: 'Reintentar',
    expiriesUnavailable:
      'Vencimientos no disponibles, así que no se pueden calcular los breakevens de las estructuras.',
    hint: 'Los breakevens son un snapshot fijo del vencimiento más cercano (0DTE) y de los vencimientos listados más cercanos a 15d y 30d, valorados al mid mediano entre exchanges. ATM: strike ± costo del straddle. Strangles: strike del put − costo y strike del call + costo, usando los strikes más cercanos a 25% del spot (15d/30d) o al 25Δ más cercano por delta mediana entre exchanges (0DTE). Velas: perpetuo de Deribit.',
  },
);

const LINES_STORAGE_KEY = 'portfolioBeTaLines';
const TIMEFRAME_STORAGE_KEY = 'portfolioBeTaTimeframe';
const DEFAULT_LINES: Record<LineKey, boolean> = {
  atm0: true,
  otm0: true,
  atm15: true,
  otm15: true,
  atm30: true,
  otm30: true,
  portfolio: true,
};

function loadLines(): Record<LineKey, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(LINES_STORAGE_KEY) ?? 'null') as unknown;
    if (raw != null && typeof raw === 'object') {
      const next = { ...DEFAULT_LINES };
      for (const key of Object.keys(DEFAULT_LINES) as LineKey[]) {
        const value = (raw as Record<string, unknown>)[key];
        if (typeof value === 'boolean') next[key] = value;
      }
      return next;
    }
  } catch {}
  return DEFAULT_LINES;
}

function loadTimeframe(): Timeframe {
  try {
    const raw = localStorage.getItem(TIMEFRAME_STORAGE_KEY);
    if (raw != null && raw in TIMEFRAMES) return raw as Timeframe;
  } catch {}
  return '30d';
}

function fmtLevel(value: number): string {
  return Math.round(value).toLocaleString();
}

function fmtMovePct(level: number, spot: number): string {
  const pct = (level / spot - 1) * 100;
  return `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(1)}%`;
}

interface ExpiriesResponse {
  expiries: string[];
  timestamps?: ExpiryCandidate[];
}

type TenorExpiries = Record<BeTenorTarget, string | null>;

function pickTenorExpiries(data: ExpiriesResponse | undefined, nowMs: number): TenorExpiries {
  const candidates = data?.timestamps ?? data?.expiries.map((expiry) => ({ expiry, expiryTs: null })) ?? [];
  return Object.fromEntries(
    BE_TENOR_TARGETS.map((days) => [days, pickNearestExpiry(candidates, days, nowMs)]),
  ) as TenorExpiries;
}

// Every TA underlying is loaded up front so switching BTC/ETH only swaps cached data.
// Snapshot chains use their own key, not the live chain cache the chain WS patches,
// so the levels stay frozen until the user refreshes the snapshot.
function usePreloadedSnapshot() {
  const expiryResults = useQueries({
    queries: TA_UNDERLYINGS.map((underlying) => ({
      queryKey: chainKeys.expiries(underlying),
      queryFn: () => fetchJson<ExpiriesResponse>(`/expiries?underlying=${underlying}`),
      staleTime: 30_000,
    })),
  });
  const expiriesKey = expiryResults.map((r) => r.dataUpdatedAt).join(',');
  const tenorsByUnderlying = useMemo(() => {
    const now = Date.now();
    return Object.fromEntries(
      TA_UNDERLYINGS.map((underlying, i) => [underlying, pickTenorExpiries(expiryResults[i]?.data, now)]),
    ) as Record<TaUnderlying, TenorExpiries>;
  }, [expiriesKey]);

  const chainTargets = TA_UNDERLYINGS.flatMap((underlying) =>
    [...new Set(Object.values(tenorsByUnderlying[underlying]).filter((e): e is string => e != null))].map(
      (expiry) => ({ underlying, expiry }),
    ),
  );
  const chainResults = useQueries({
    queries: chainTargets.map(({ underlying, expiry }) => ({
      queryKey: ['be-snapshot-chain', underlying, expiry],
      queryFn: () => fetchJson<EnrichedChainResponse>(`/chains?underlying=${underlying}&expiry=${expiry}`),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });

  return {
    tenorsByUnderlying,
    refetchExpiries: () => {
      for (const result of expiryResults) void result.refetch();
    },
    expiriesErrorFor: (underlying: TaUnderlying) =>
      expiryResults[TA_UNDERLYINGS.indexOf(underlying)]?.isError ?? false,
    chainsFor: (underlying: TaUnderlying) =>
      chainTargets.flatMap((target, i) =>
        target.underlying === underlying ? [{ expiry: target.expiry, result: chainResults[i]! }] : [],
      ),
  };
}

function usePreloadedCandles(timeframe: Timeframe) {
  const tf = TIMEFRAMES[timeframe];
  return useQueries({
    queries: TA_UNDERLYINGS.map((underlying) => ({
      queryKey: ['spot-candles', underlying, tf.resolution, tf.buckets],
      queryFn: () =>
        fetchJson<SpotCandlesResponse>(
          `/spot-candles?currency=${underlying}&resolution=${tf.resolution}&buckets=${tf.buckets}`,
        ),
      staleTime: 30_000,
      refetchInterval: 60_000,
      // Placeholder is per underlying (fixed query index), so a timeframe switch may
      // briefly show the same coin's previous range but never the other coin's candles.
      placeholderData: (prev: SpotCandlesResponse | undefined) => prev,
    })),
  });
}

interface Props {
  underlying: TaUnderlying;
  onUnderlyingChange: (underlying: TaUnderlying) => void;
  portfolioUnderlying: string | null;
  portfolioBreakEvensUsd: number[];
}

export default function BreakevenTaChart({
  underlying,
  onUnderlyingChange,
  portfolioUnderlying,
  portfolioBreakEvensUsd,
}: Props) {
  const t = useT(messages);
  const [lines, setLines] = useState(loadLines);
  const [timeframe, setTimeframe] = useState(loadTimeframe);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const didFitRef = useRef(false);

  const snapshot = usePreloadedSnapshot();
  const tenorExpiries = snapshot.tenorsByUnderlying[underlying];
  const expiriesError = snapshot.expiriesErrorFor(underlying);
  const chainEntries = snapshot.chainsFor(underlying);
  const chainsByExpiry = new Map<string, EnrichedChainResponse>();
  for (const { expiry, result } of chainEntries) {
    if (result.data) chainsByExpiry.set(expiry, result.data);
  }
  const chainsLoading = chainEntries.some(({ result }) => result.isLoading);
  const chainsFetching = chainEntries.some(({ result }) => result.isFetching);
  const snapshotAt = chainEntries.reduce((max, { result }) => Math.max(max, result.dataUpdatedAt), 0);
  const snapshotKey = `${underlying}:${chainEntries.map(({ expiry, result }) => `${expiry}@${result.dataUpdatedAt}`).join(',')}`;

  const structures = useMemo(() => {
    const out: Partial<Record<Exclude<LineKey, 'portfolio'>, StructureBreakevens | null>> = {};
    for (const days of BE_TENOR_TARGETS) {
      const expiry = tenorExpiries[days];
      const chain = expiry != null ? chainsByExpiry.get(expiry) : undefined;
      out[`atm${days}`] = chain ? atmStraddleBreakevens(chain) : null;
      out[`otm${days}`] = chain ? (days === 0 ? deltaStrangleBreakevens(chain) : otmStrangleBreakevens(chain)) : null;
    }
    return out;
    // chainsByExpiry is rebuilt every render; snapshotKey changes exactly when its data does.
  }, [tenorExpiries, snapshotKey]);

  const portfolioLevels = useMemo(
    () => (portfolioUnderlying === underlying ? portfolioBreakEvensUsd : []),
    [portfolioUnderlying, underlying, portfolioBreakEvensUsd],
  );
  const refSpot = structures.atm15?.refSpotUsd ?? structures.atm30?.refSpotUsd ?? structures.atm0?.refSpotUsd ?? null;

  const candleResult = usePreloadedCandles(timeframe)[TA_UNDERLYINGS.indexOf(underlying)]!;
  const candleData = candleResult.data?.currency === underlying ? candleResult.data : undefined;
  const candlesLoading = candleData == null && !candleResult.isError;
  const candlesError = candleResult.isError && candleData == null;
  const candlesPlaceholder = candleResult.isPlaceholderData;
  const refetchCandles = candleResult.refetch;

  const activeLevels = useMemo(() => {
    const levels: Array<{ spec: LineSpec; price: number; side: 'lower' | 'upper' | null }> = [];
    for (const spec of LINE_SPECS) {
      if (!lines[spec.key]) continue;
      if (spec.key === 'portfolio') {
        for (const price of portfolioLevels) levels.push({ spec, price, side: null });
        continue;
      }
      const s = structures[spec.key];
      if (s == null) continue;
      levels.push({ spec, price: s.lowerUsd, side: 'lower' });
      levels.push({ spec, price: s.upperUsd, side: 'upper' });
    }
    return levels;
  }, [lines, structures, portfolioLevels]);

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
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.06, bottom: 0.06 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false, rightOffset: 6 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#4ade80',
      downColor: '#f87171',
      wickUpColor: '#4ade80',
      wickDownColor: '#f87171',
      borderVisible: false,
    }) as ISeriesApi<'Candlestick', Time>;
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  useEffect(() => {
    didFitRef.current = false;
  }, [underlying, timeframe]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!candleData) {
      series.setData([]);
      return;
    }
    series.setData(
      candleData.candles.map((c) => ({
        time: Math.floor(c.timestamp / 1000) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    if (!didFitRef.current && !candlesPlaceholder) {
      chartRef.current?.timeScale().fitContent();
      didFitRef.current = true;
    }
  }, [candleData, candlesPlaceholder]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = activeLevels.map(({ spec, price, side }) =>
      series.createPriceLine({
        price,
        color: spec.color,
        lineWidth: 1,
        lineStyle: spec.style,
        axisLabelVisible: true,
        title:
          spec.key === 'portfolio'
            ? t('portfolio')
            : `${spec.label.split(' ').slice(0, 2).join(' ')} ${side === 'upper' ? '▲' : '▼'}${refSpot != null ? ` ${fmtMovePct(price, refSpot)}` : ''}`,
      }),
    );
    // Price lines are not part of autoscale; widen the range so far wings stay on-screen.
    const prices = activeLevels.map((l) => l.price);
    series.applyOptions({
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (res?.priceRange == null || prices.length === 0) return res;
        return {
          ...res,
          priceRange: {
            minValue: Math.min(res.priceRange.minValue, ...prices),
            maxValue: Math.max(res.priceRange.maxValue, ...prices),
          },
        };
      },
    });
  }, [activeLevels, refSpot, t]);

  const toggle = (key: LineKey) => {
    setLines((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(LINES_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const selectTimeframe = (next: Timeframe) => {
    setTimeframe(next);
    try {
      localStorage.setItem(TIMEFRAME_STORAGE_KEY, next);
    } catch {}
  };

  const refreshSnapshot = () => {
    // Re-picks tenors too, so the 0DTE line rolls to the next daily after 08:00 UTC settlement.
    snapshot.refetchExpiries();
    for (const { result } of chainEntries) void result.refetch();
  };

  const chipDetail = (spec: LineSpec): { text: string; available: boolean } => {
    if (spec.key === 'portfolio') {
      if (portfolioLevels.length > 0) return { text: portfolioLevels.map(fmtLevel).join(' / '), available: true };
      return {
        text:
          portfolioUnderlying != null && portfolioUnderlying !== underlying
            ? t('bookIs', { u: portfolioUnderlying })
            : t('noBe'),
        available: false,
      };
    }
    const s = structures[spec.key];
    if (s == null) return { text: chainsLoading ? t('loading') : t('unavailable'), available: false };
    const strikes = s.putStrike === s.callStrike ? fmtLevel(s.putStrike) : `${fmtLevel(s.putStrike)}P/${fmtLevel(s.callStrike)}C`;
    return {
      text: `${formatExpiry(s.expiry)} · K ${strikes} · $${fmtLevel(s.premiumUsd)} · ${fmtLevel(s.lowerUsd)} / ${fmtLevel(s.upperUsd)}`,
      available: true,
    };
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.group} role="radiogroup" aria-label={t('taUnderlying')}>
          {TA_UNDERLYINGS.map((u) => (
            <button
              key={u}
              type="button"
              className={styles.tab}
              data-active={u === underlying || undefined}
              onClick={() => onUnderlyingChange(u)}
            >
              {u}
            </button>
          ))}
        </div>
        <div className={styles.group} role="radiogroup" aria-label={t('candleRange')}>
          {(Object.keys(TIMEFRAMES) as Timeframe[]).map((tf) => (
            <button
              key={tf}
              type="button"
              className={styles.tab}
              data-active={tf === timeframe || undefined}
              onClick={() => selectTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <span className={styles.snapshot}>
          {snapshotAt > 0
            ? t('beSnapshot', {
                time: new Date(snapshotAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              })
            : t('beSnapshotEmpty')}
          {refSpot != null && t('refSpot', { v: fmtLevel(refSpot) })}
        </span>
        <button type="button" className={styles.refresh} onClick={refreshSnapshot} disabled={chainsFetching || chainEntries.length === 0}>
          {chainsFetching ? t('refreshing') : t('refreshSnapshot')}
        </button>
      </div>

      <div className={styles.chips}>
        {LINE_SPECS.map((spec) => {
          const detail = chipDetail(spec);
          return (
            <button
              key={spec.key}
              type="button"
              className={styles.chip}
              data-active={lines[spec.key] || undefined}
              data-unavailable={!detail.available || undefined}
              aria-pressed={lines[spec.key]}
              onClick={() => toggle(spec.key)}
            >
              <span
                className={styles.swatch}
                style={{
                  borderTopColor: spec.color,
                  borderTopStyle: spec.style === LineStyle.Solid ? 'solid' : spec.style === LineStyle.Dashed ? 'dashed' : 'dotted',
                }}
              />
              <span className={styles.chipLabel}>{t(spec.key)}</span>
              <span className={styles.chipDetail}>{detail.text}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.chartWrap}>
        <div className={styles.canvas} ref={containerRef} />
        {candlesLoading && <div className={styles.overlay}>{t('loadingSpot', { u: underlying })}</div>}
        {candlesError && (
          <div className={styles.overlay}>
            <div>{t('spotUnavailable')}</div>
            <button type="button" className={styles.refresh} onClick={() => void refetchCandles()}>
              {t('retry')}
            </button>
          </div>
        )}
      </div>

      <div className={styles.hint}>
        {expiriesError
          ? t('expiriesUnavailable')
          : t('hint')}
      </div>
    </div>
  );
}
