import { useEffect, useRef, useState } from 'react';
import { ColorType, LineSeries, createChart, type IChartApi } from 'lightweight-charts';

import { getTokenLogo } from '@lib/token-meta';
import type { IvHistoryPoint, IvTenor } from '@shared/enriched';
import { getHistoryCoverage } from './history-coverage';
import { useIvHistory, type IvHistoryWindow } from './queries';
import styles from './SkewHistory.module.css';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const RR_COLOR = '#50d2c1';
const FLY_COLOR = '#f59e0b';

const RR_TIP =
  '25Δ RISK-REVERSAL — call25 IV − put25 IV.\n\n' +
  '• Positive: calls richer than puts → upside fear/FOMO.\n' +
  '• Negative: puts richer than calls → downside fear (the usual state in BTC/ETH).\n' +
  '• Moves to zero when skew compresses; blow-outs often precede directional regimes.';

const FLY_TIP =
  '25Δ BUTTERFLY — (call25 IV + put25 IV) / 2 − ATM IV.\n\n' +
  '• Measures wing richness vs body — the convexity premium.\n' +
  '• High fly: wings are expensive (fat-tail pricing, event premium).\n' +
  '• Low/negative fly: wings cheap vs body — possible vega pay for directional skew.';

function toLineData(series: IvHistoryPoint[], key: 'rr25d' | 'bfly25d') {
  // lightweight-charts needs seconds + ascending unique timestamps.
  const rows: Array<{ time: number; value: number }> = [];
  let prev = -Infinity;
  for (const p of series) {
    const v = p[key];
    if (v == null || !Number.isFinite(v)) continue;
    const t = Math.floor(p.ts / 1000);
    if (t <= prev) continue;
    rows.push({ time: t, value: v * 100 });
    prev = t;
  }
  return rows;
}

interface Props {
  underlying: string;
}

export default function SkewHistory({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const [tenor, setTenor] = useState<IvTenor>('30d');
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { data } = useIvHistory(underlying, window);
  const result = data?.tenors[tenor];
  const series = result?.series ?? [];

  const rrData = toLineData(series, 'rr25d');
  const flyData = toLineData(series, 'bfly25d');
  const hasAnyPoints = rrData.length > 0 || flyData.length > 0;
  const coverage = getHistoryCoverage(series, window, ['rr25d', 'bfly25d']);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#555b5e',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: {
        borderColor: '#1F2937',
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: { borderColor: '#1F2937', timeVisible: true },
      crosshair: {
        horzLine: { color: RR_COLOR, labelBackgroundColor: '#0E3333' },
        vertLine: { color: RR_COLOR, labelBackgroundColor: '#0E3333', labelVisible: false },
      },
    });

    const priceFmt = {
      type: 'custom' as const,
      formatter: (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`,
    };

    const rr = chart.addSeries(LineSeries, {
      color: RR_COLOR,
      lineWidth: 1,
      priceFormat: priceFmt,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const fly = chart.addSeries(LineSeries, {
      color: FLY_COLOR,
      lineWidth: 1,
      priceFormat: priceFmt,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    rr.setData(rrData as never);
    fly.setData(flyData as never);
    chart.timeScale().fitContent();

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
    // We rebuild the chart whenever inputs change; the series arrays are
    // regenerated on every render so JSON keying matches deep equality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlying, tenor, window, JSON.stringify(rrData), JSON.stringify(flyData)]);

  const logo = getTokenLogo(underlying);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          {logo && <img src={logo} alt="" className={styles.tokenLogo} />}
          {underlying} SKEW
        </span>
        <div className={styles.toggles}>
          <span className={styles.toggleLabel}>TENOR</span>
          <div className={styles.toggleGroup}>
            {TENORS.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.toggleBtn}
                data-active={tenor === t ? 'true' : undefined}
                onClick={() => setTenor(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <span className={styles.toggleLabel}>WINDOW</span>
          <div className={styles.toggleGroup}>
            <button
              type="button"
              className={styles.toggleBtn}
              data-active={window === '30d' ? 'true' : undefined}
              onClick={() => setWindow('30d')}
            >
              30d
            </button>
            <button
              type="button"
              className={styles.toggleBtn}
              data-active={window === '90d' ? 'true' : undefined}
              onClick={() => setWindow('90d')}
            >
              90d
            </button>
          </div>
        </div>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem} title={RR_TIP}>
          <span className={styles.legendSwatch} style={{ background: RR_COLOR }} />
          25Δ RR (call − put)
        </span>
        <span className={styles.legendItem} title={FLY_TIP}>
          <span className={styles.legendSwatch} style={{ background: FLY_COLOR }} />
          25Δ Fly (wing − ATM)
        </span>
      </div>
      <div className={styles.coverage} data-short={coverage.short ? 'true' : undefined}>
        {coverage.label}
      </div>

      <div className={styles.chartArea}>
        <div className={styles.chartWrap} ref={containerRef} />
        {!hasAnyPoints && <div className={styles.empty}>accumulating history…</div>}
      </div>
    </div>
  );
}
