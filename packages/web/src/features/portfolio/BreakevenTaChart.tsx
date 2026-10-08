import { useQueries, useQuery } from '@tanstack/react-query';
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

import { useExpiries } from '@features/chain';
import { fetchJson } from '@lib/http';
import { formatExpiry } from '@lib/format';
import type { SpotCandleResolutionSec, SpotCandlesResponse } from '@shared/common';
import type { EnrichedChainResponse } from '@shared/enriched';

import {
  BE_TENOR_TARGETS,
  atmStraddleBreakevens,
  otmStrangleBreakevens,
  pickNearestExpiry,
  type BeTenorTarget,
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

type LineKey = 'atm15' | 'otm15' | 'atm30' | 'otm30' | 'portfolio';

interface LineSpec {
  key: LineKey;
  label: string;
  color: string;
  style: LineStyle;
}

const LINE_SPECS: LineSpec[] = [
  { key: 'atm15', label: '15d ATM straddle', color: '#a78bfa', style: LineStyle.Solid },
  { key: 'otm15', label: '15d 25% OTM strangle', color: '#38bdf8', style: LineStyle.Solid },
  { key: 'atm30', label: '30d ATM straddle', color: '#c4b5fd', style: LineStyle.Dashed },
  { key: 'otm30', label: '30d 25% OTM strangle', color: '#7dd3fc', style: LineStyle.Dashed },
  { key: 'portfolio', label: 'Portfolio BE', color: '#fbbf24', style: LineStyle.Dotted },
];

const LINES_STORAGE_KEY = 'portfolioBeTaLines';
const TIMEFRAME_STORAGE_KEY = 'portfolioBeTaTimeframe';
const DEFAULT_LINES: Record<LineKey, boolean> = { atm15: true, otm15: true, atm30: true, otm30: true, portfolio: true };

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

// Separate query key from the live chain cache: the chain WS patches that cache,
// and these levels must stay frozen until the user refreshes the snapshot.
function useSnapshotChains(underlying: string, expiries: string[]) {
  return useQueries({
    queries: expiries.map((expiry) => ({
      queryKey: ['be-snapshot-chain', underlying, expiry],
      queryFn: () => fetchJson<EnrichedChainResponse>(`/chains?underlying=${underlying}&expiry=${expiry}`),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
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
  const [lines, setLines] = useState(loadLines);
  const [timeframe, setTimeframe] = useState(loadTimeframe);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const { data: expiriesData, isError: expiriesError } = useExpiries(underlying);
  const tenorExpiries = useMemo(() => {
    const now = Date.now();
    const timestamps = expiriesData?.timestamps ?? [];
    return Object.fromEntries(
      BE_TENOR_TARGETS.map((days) => [days, pickNearestExpiry(timestamps, days, now)]),
    ) as Record<BeTenorTarget, string | null>;
  }, [expiriesData]);
  const uniqueExpiries = useMemo(
    () => [...new Set(Object.values(tenorExpiries).filter((e): e is string => e != null))],
    [tenorExpiries],
  );

  const chainResults = useSnapshotChains(underlying, uniqueExpiries);
  const chainsByExpiry = new Map<string, EnrichedChainResponse>();
  chainResults.forEach((result, i) => {
    if (result.data) chainsByExpiry.set(uniqueExpiries[i]!, result.data);
  });
  const chainsLoading = chainResults.some((r) => r.isLoading);
  const chainsFetching = chainResults.some((r) => r.isFetching);
  const snapshotAt = chainResults.reduce((max, r) => Math.max(max, r.dataUpdatedAt), 0);
  const snapshotKey = chainResults.map((r) => r.dataUpdatedAt).join(',');

  const structures = useMemo(() => {
    const out: Partial<Record<Exclude<LineKey, 'portfolio'>, StructureBreakevens | null>> = {};
    for (const days of BE_TENOR_TARGETS) {
      const expiry = tenorExpiries[days];
      const chain = expiry != null ? chainsByExpiry.get(expiry) : undefined;
      out[`atm${days}`] = chain ? atmStraddleBreakevens(chain) : null;
      out[`otm${days}`] = chain ? otmStrangleBreakevens(chain) : null;
    }
    return out;
    // chainsByExpiry is rebuilt every render; snapshotKey changes exactly when its data does.
  }, [tenorExpiries, snapshotKey]);

  const portfolioLevels = useMemo(
    () => (portfolioUnderlying === underlying ? portfolioBreakEvensUsd : []),
    [portfolioUnderlying, underlying, portfolioBreakEvensUsd],
  );
  const refSpot = structures.atm15?.refSpotUsd ?? structures.atm30?.refSpotUsd ?? null;

  const tf = TIMEFRAMES[timeframe];
  const {
    data: candleData,
    isLoading: candlesLoading,
    error: candlesError,
    refetch: refetchCandles,
  } = useQuery({
    queryKey: ['spot-candles', underlying, tf.resolution, tf.buckets],
    queryFn: () =>
      fetchJson<SpotCandlesResponse>(
        `/spot-candles?currency=${underlying}&resolution=${tf.resolution}&buckets=${tf.buckets}`,
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: (prev: SpotCandlesResponse | undefined) => prev,
  });

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
    const series = seriesRef.current;
    if (!series || !candleData) return;
    series.setData(
      candleData.candles.map((c) => ({
        time: Math.floor(c.timestamp / 1000) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [candleData]);

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
            ? 'Portfolio BE'
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
  }, [activeLevels, refSpot]);

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
    for (const result of chainResults) void result.refetch();
  };

  const chipDetail = (spec: LineSpec): { text: string; available: boolean } => {
    if (spec.key === 'portfolio') {
      if (portfolioLevels.length > 0) return { text: portfolioLevels.map(fmtLevel).join(' / '), available: true };
      return {
        text: portfolioUnderlying != null && portfolioUnderlying !== underlying ? `book is ${portfolioUnderlying}` : 'no BE',
        available: false,
      };
    }
    const s = structures[spec.key];
    if (s == null) return { text: chainsLoading ? 'loading…' : 'unavailable', available: false };
    const strikes = s.putStrike === s.callStrike ? fmtLevel(s.putStrike) : `${fmtLevel(s.putStrike)}P/${fmtLevel(s.callStrike)}C`;
    return {
      text: `${formatExpiry(s.expiry)} · K ${strikes} · $${fmtLevel(s.premiumUsd)} · ${fmtLevel(s.lowerUsd)} / ${fmtLevel(s.upperUsd)}`,
      available: true,
    };
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.group} role="radiogroup" aria-label="TA underlying">
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
        <div className={styles.group} role="radiogroup" aria-label="Candle range">
          {(Object.keys(TIMEFRAMES) as Timeframe[]).map((t) => (
            <button
              key={t}
              type="button"
              className={styles.tab}
              data-active={t === timeframe || undefined}
              onClick={() => selectTimeframe(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <span className={styles.snapshot}>
          {snapshotAt > 0 ? `BE snapshot ${new Date(snapshotAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'BE snapshot —'}
          {refSpot != null && ` · ref spot ${fmtLevel(refSpot)}`}
        </span>
        <button type="button" className={styles.refresh} onClick={refreshSnapshot} disabled={chainsFetching || uniqueExpiries.length === 0}>
          {chainsFetching ? 'Refreshing…' : 'Refresh snapshot'}
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
              <span className={styles.chipLabel}>{spec.label}</span>
              <span className={styles.chipDetail}>{detail.text}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.chartWrap}>
        <div className={styles.canvas} ref={containerRef} />
        {candlesLoading && !candleData && <div className={styles.overlay}>Loading spot history…</div>}
        {candlesError && (
          <div className={styles.overlay}>
            <div>Spot history unavailable</div>
            <button type="button" className={styles.refresh} onClick={() => void refetchCandles()}>
              Retry
            </button>
          </div>
        )}
      </div>

      <div className={styles.hint}>
        {expiriesError
          ? 'Expiries unavailable, so structure break-evens cannot be computed.'
          : 'Break-evens are a frozen snapshot from the listed expiries nearest 15d and 30d, priced at the median venue mid. ATM: strike ± straddle cost. 25% OTM: put strike − cost and call strike + cost, using strikes nearest 25% from spot. Candles: Deribit perpetual.'}
      </div>
    </div>
  );
}
