import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesPartialOptions,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts';
import type { VolHeatmapColumn } from '@oggregator/protocol';

import { useAppStore } from '@stores/app-store';
import { EmptyState, Spinner } from '@components/ui';
import {
  fmtVega,
  HEATMAP_WINDOWS,
  heatScaleMax,
  type HeatSide,
  walls,
  weightedIvRange,
} from './heatmap-model';
import { type HeatBar, HeatSeries, type HeatSeriesOptions } from './heatmap-series';
import { useVolHeatmap } from './queries';
import styles from './DvolHeatmap.module.css';

const CURRENCIES = ['BTC', 'ETH'] as const;
const SIDES: ReadonlyArray<{ id: HeatSide; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'bids', label: 'Bids' },
  { id: 'asks', label: 'Offers' },
];

type HeatApi = ISeriesApi<
  'Custom',
  Time,
  HeatBar | WhitespaceData<Time>,
  HeatSeriesOptions,
  SeriesPartialOptions<HeatSeriesOptions>
>;

interface Hover {
  iv: number;
  bid: number;
  ask: number;
}

function toBar(column: VolHeatmapColumn, bucketPct: number): HeatBar {
  const range = weightedIvRange(column.cells, bucketPct);
  const fallback = column.dvol != null ? column.dvol * 100 : 0;
  return {
    time: (column.t / 1000) as UTCTimestamp,
    cells: column.cells.map(([bucket, bid, ask]) => [bucket * bucketPct, bid, ask] as const),
    trades: column.trades.map((t) => ({ iv: t.iv * 100, vega: t.vega, side: t.side })),
    low: range?.low ?? fallback,
    high: range?.high ?? fallback,
  };
}

export default function DvolHeatmap() {
  const underlying = useAppStore((s) => s.underlying);
  const [currency, setCurrency] = useState<string>(
    CURRENCIES.includes(underlying as (typeof CURRENCIES)[number]) ? underlying : 'BTC',
  );
  const [windowIndex, setWindowIndex] = useState(1);
  const [side, setSide] = useState<HeatSide>('all');
  const [hover, setHover] = useState<Hover | null>(null);
  const window = HEATMAP_WINDOWS[windowIndex]!;
  const { data, isLoading, error } = useVolHeatmap(currency, window);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const heatRef = useRef<HeatApi | null>(null);
  const dvolRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bucketPctRef = useRef(0.25);
  const fittedViewRef = useRef<string | null>(null);
  const viewKey = `${currency}:${window.label}`;

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0A0A0A' },
        textColor: '#555B5E',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: '#161616' } },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false, rightOffset: 2 },
    });
    const heat: HeatApi = chart.addCustomSeries(new HeatSeries(), {
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(2)}%` },
    });
    const dvol = chart.addSeries(LineSeries, {
      color: '#50D2C1',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(2)}%` },
    });

    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(heat) as HeatBar | undefined;
      const price = param.point != null ? heat.coordinateToPrice(param.point.y) : null;
      if (bar == null || price == null || !('cells' in bar)) {
        setHover(null);
        return;
      }
      const bucketPct = bucketPctRef.current;
      const centre = Math.round(price / bucketPct) * bucketPct;
      const cell = bar.cells.find(([iv]) => Math.abs(iv - centre) < bucketPct / 2);
      setHover({ iv: centre, bid: cell?.[1] ?? 0, ask: cell?.[2] ?? 0 });
    });

    chartApiRef.current = chart;
    heatRef.current = heat;
    dvolRef.current = dvol;
    return () => {
      chart.remove();
      chartApiRef.current = null;
      heatRef.current = null;
      dvolRef.current = null;
    };
  }, []);

  const columns = useMemo(() => data?.columns ?? [], [data]);
  const bucketPct = (data?.bucketSize ?? 0.0025) * 100;

  useEffect(() => {
    const heat = heatRef.current;
    const dvol = dvolRef.current;
    if (heat == null || dvol == null) return;
    bucketPctRef.current = bucketPct;
    let tradeMax = 1;
    for (const c of columns) for (const t of c.trades) tradeMax = Math.max(tradeMax, t.vega);
    heat.applyOptions({ bucketPct, side, scaleMax: heatScaleMax(columns, side), tradeScaleMax: tradeMax });
    heat.setData(columns.map((c) => toBar(c, bucketPct)));
    dvol.setData(
      columns
        .filter((c) => c.dvol != null)
        .map((c) => ({ time: (c.t / 1000) as UTCTimestamp, value: c.dvol! * 100 })),
    );
    // Fit once per currency/window, when its first data lands, so polls don't reset the user's zoom.
    if (columns.length > 0 && fittedViewRef.current !== viewKey) {
      fittedViewRef.current = viewKey;
      chartApiRef.current?.timeScale().applyOptions({ secondsVisible: window.resolutionSec < 60 });
      chartApiRef.current?.timeScale().fitContent();
    }
  }, [columns, bucketPct, side, viewKey, window.resolutionSec]);

  const last = columns.at(-1);
  const { bid: bidWall, ask: askWall } = walls(last, bucketPct);
  const meta = data?.meta;

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>DVOL Liquidity Heatmap</span>
            <div className={styles.picker}>
              {CURRENCIES.map((c) => (
                <button key={c} className={styles.pickerBtn} data-active={c === currency} onClick={() => setCurrency(c)}>
                  {c}
                </button>
              ))}
            </div>
            <div className={styles.picker}>
              {HEATMAP_WINDOWS.map((w, i) => (
                <button key={w.label} className={styles.pickerBtn} data-active={i === windowIndex} onClick={() => setWindowIndex(i)}>
                  {w.label}
                </button>
              ))}
            </div>
            <div className={styles.picker}>
              {SIDES.map((s) => (
                <button key={s.id} className={styles.pickerBtn} data-active={s.id === side} onClick={() => setSide(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <span className={styles.subtitle}>
            Resting vega ($ per vol pt) on Deribit books by IV
            {meta ? ` · ${meta.instruments} options · ${meta.expiries.join(' / ')}` : ''}
          </span>
          <div className={styles.legend}>
            <span className={styles.legendLine} />
            <span className={styles.legendText}>DVOL</span>
            <span className={styles.legendDot} data-side="buy" />
            <span className={styles.legendText}>Buy prints</span>
            <span className={styles.legendDot} data-side="sell" />
            <span className={styles.legendText}>Sell prints</span>
            {hover && (
              <span className={styles.hover}>
                {hover.iv.toFixed(2)}% · bids {fmtVega(hover.bid)} · offers {fmtVega(hover.ask)}
              </span>
            )}
          </div>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>DVOL</span>
            <span className={styles.statValue} data-accent>
              {last?.dvol != null ? `${(last.dvol * 100).toFixed(2)}%` : '—'}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Bid wall</span>
            <span className={styles.statValue} data-side="bid">
              {bidWall ? `${bidWall[0].toFixed(2)}% · ${fmtVega(bidWall[1])}` : '—'}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Offer wall</span>
            <span className={styles.statValue} data-side="ask">
              {askWall ? `${askWall[0].toFixed(2)}% · ${fmtVega(askWall[1])}` : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.chartArea}>
        {isLoading && (
          <div className={styles.chartOverlay}>
            <Spinner size="lg" />
          </div>
        )}
        {!isLoading && (error != null || columns.length === 0) && (
          <div className={styles.chartOverlay}>
            <EmptyState
              icon={error != null ? '⚠' : '◌'}
              title={error != null ? 'Heatmap unavailable' : 'Collecting order books'}
              detail="Deribit serves no historical books, so the heatmap fills from when the server started."
            />
          </div>
        )}
        <div className={styles.chartWrap} ref={chartRef} />
        <button
          className={styles.resetBtn}
          onClick={() => chartApiRef.current?.timeScale().fitContent()}
          title="Reset zoom"
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
