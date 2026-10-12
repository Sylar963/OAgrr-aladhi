import { useEffect, useRef, useState } from 'react';
import {
  BaselineSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

import type { EquityHistoryPoint, EquityHistoryRange, EquityHistoryVenue } from '@oggregator/protocol';
import { VENUES } from '@lib/venue-meta';

import { useEquityHistory } from './hooks/queries';
import styles from './BreakevenTaChart.module.css';

const RANGES: readonly EquityHistoryRange[] = ['1M', '3M'];
const RANGE_STORAGE_KEY = 'portfolioEquityRange';
const NO_POINTS: EquityHistoryPoint[] = [];

function loadRange(): EquityHistoryRange {
  try {
    if (localStorage.getItem(RANGE_STORAGE_KEY) === '3M') return '3M';
  } catch {}
  return '1M';
}

function fmtUsd(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

function fmtSignedUsd(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '$0';
  return `${rounded > 0 ? '+' : '-'}$${Math.abs(rounded).toLocaleString()}`;
}

interface Props {
  venue: EquityHistoryVenue;
}

export default function EquityHistoryChart({ venue }: Props) {
  const [range, setRange] = useState<EquityHistoryRange>(loadRange);
  const { data, isError, error, isLoading, refetch } = useEquityHistory(venue, range);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Baseline', Time> | null>(null);
  const venueLabel = VENUES[venue]?.label ?? venue;
  const points = data?.venue === venue && data.range === range ? data.points : NO_POINTS;

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
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#1F2937', timeVisible: false, rightOffset: 2 },
    });
    const series = chart.addSeries(BaselineSeries, {
      topLineColor: '#4ade80',
      topFillColor1: 'rgba(74, 222, 128, 0.22)',
      topFillColor2: 'rgba(74, 222, 128, 0.02)',
      bottomLineColor: '#f87171',
      bottomFillColor1: 'rgba(248, 113, 113, 0.02)',
      bottomFillColor2: 'rgba(248, 113, 113, 0.22)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    }) as ISeriesApi<'Baseline', Time>;
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const start = points[0]?.equityUsd ?? 0;
    series.applyOptions({ baseValue: { type: 'price', price: start } });
    series.setData(points.map((p) => ({ time: Math.floor(p.ts / 1000) as Time, value: p.equityUsd })));
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  const selectRange = (next: EquityHistoryRange) => {
    setRange(next);
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, next);
    } catch {}
  };

  const first = points[0];
  const last = points[points.length - 1];
  const change = first != null && last != null ? last.equityUsd - first.equityUsd : null;
  const changePct = change != null && first != null && first.equityUsd > 0 ? (change / first.equityUsd) * 100 : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.group} role="radiogroup" aria-label="Equity range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={r === range}
              className={styles.tab}
              data-active={r === range || undefined}
              onClick={() => selectRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <span className={styles.snapshot}>
          {venueLabel}
          {last != null && ` · equity ${fmtUsd(last.equityUsd)}`}
          {change != null && ` · ${range} ${fmtSignedUsd(change)}`}
          {changePct != null && ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)`}
        </span>
      </div>

      <div className={styles.chartWrap}>
        <div className={styles.canvas} ref={containerRef} />
        {isLoading && <div className={styles.overlay}>Loading {venueLabel} equity history…</div>}
        {isError && (
          <div className={styles.overlay}>
            <div>{error instanceof Error ? error.message : 'Equity history unavailable'}</div>
            <button type="button" className={styles.refresh} onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        )}
        {!isLoading && !isError && points.length === 0 && (
          <div className={styles.overlay}>No {venueLabel} equity history in this range.</div>
        )}
      </div>

      <div className={styles.hint}>
        {data?.basis === 'cash_replay'
          ? `Daily cash balance at 00:00 UTC, rebuilt from ${venueLabel}'s transaction log (settlements, funding, deposits, withdrawals). The last point adds the current unrealised P&L. Non-USD collateral uses today's index price.`
          : `Daily mark-to-market account value reported by ${venueLabel}. Deposits and withdrawals show up as equity changes.`}
      </div>
    </div>
  );
}
