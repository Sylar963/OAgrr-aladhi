import { useEffect, useRef, useState } from 'react';
import {
  BaselineSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
} from 'lightweight-charts';

import { getTokenLogo } from '@lib/token-meta';
import type { IvTenor } from '@shared/enriched';
import { getHistoryCoverage } from './history-coverage';
import { useIvHistory, type IvHistoryWindow } from './queries';
import {
  buildSkewLineData,
  formatSkewDisplayValue,
  latestSkewDisplayValue,
  referenceLines,
  zoneFor,
  type SkewDisplayMode,
  type SkewLinePoint,
  type SkewZone,
} from './skew-history-utils';
import styles from './SkewHistory.module.css';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const DISPLAY_MODES: SkewDisplayMode[] = ['raw', 'normalized', 'zscore'];
const DISPLAY_LABELS: Record<SkewDisplayMode, string> = {
  raw: 'Raw',
  normalized: 'Normalized',
  zscore: 'Z-Score',
};
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

function axisFormatter(mode: SkewDisplayMode) {
  return (value: number) => {
    const sign = value > 0 ? '+' : '';
    if (mode === 'zscore') return `${sign}${value.toFixed(2)}σ`;
    return `${sign}${value.toFixed(1)}%`;
  };
}

function SkewMiniChart({
  title,
  color,
  data,
  latest,
  mode,
  zone,
}: {
  title: string;
  color: string;
  data: SkewLinePoint[];
  latest: string;
  mode: SkewDisplayMode;
  zone: SkewZone | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

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
        scaleMargins: { top: 0.18, bottom: 0.18 },
      },
      timeScale: { borderColor: '#1F2937', timeVisible: true },
      crosshair: {
        horzLine: { color, labelBackgroundColor: '#0E3333' },
        vertLine: { color, labelBackgroundColor: '#0E3333', labelVisible: false },
      },
    });

    if (mode === 'zscore' && data.length >= 2) {
      const firstTime = data[0]!.time;
      const lastTime = data[data.length - 1]!.time;
      const bandFill = 'rgba(0, 233, 151, 0.10)';
      const transparent = 'rgba(0, 0, 0, 0)';
      const upper = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topFillColor1: bandFill,
        topFillColor2: bandFill,
        topLineColor: transparent,
        bottomFillColor1: transparent,
        bottomFillColor2: transparent,
        bottomLineColor: transparent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      upper.setData([
        { time: firstTime, value: 1 },
        { time: lastTime, value: 1 },
      ] as never);
      const lower = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topFillColor1: transparent,
        topFillColor2: transparent,
        topLineColor: transparent,
        bottomFillColor1: bandFill,
        bottomFillColor2: bandFill,
        bottomLineColor: transparent,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      lower.setData([
        { time: firstTime, value: -1 },
        { time: lastTime, value: -1 },
      ] as never);
    }

    const line = chart.addSeries(LineSeries, {
      color,
      lineWidth: 1,
      priceFormat: {
        type: 'custom' as const,
        formatter: axisFormatter(mode),
      },
      lastValueVisible: false,
      priceLineVisible: false,
    });

    line.setData(data as never);

    for (const ref of referenceLines(mode)) {
      line.createPriceLine({
        price: ref.price,
        color: ref.emphasis === 'strong' ? '#3a4248' : '#23292e',
        lineWidth: 1,
        lineStyle: ref.emphasis === 'strong' ? LineStyle.Dashed : LineStyle.Dotted,
        axisLabelVisible: true,
        title: ref.label,
      });
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, color, mode, JSON.stringify(data)]);

  return (
    <div className={styles.miniChart}>
      <div className={styles.metricHeader}>
        <span className={styles.metricName} style={{ color }}>
          {title}
        </span>
        <span className={styles.metricValue} data-zone={zone ?? undefined}>
          {latest}
        </span>
      </div>
      <div className={styles.chartWrap}>
        <div className={styles.chartCanvas} ref={containerRef} />
        {data.length === 0 && <div className={styles.empty}>insufficient data</div>}
      </div>
    </div>
  );
}

interface Props {
  underlying: string;
}

export default function SkewHistory({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const [tenor, setTenor] = useState<IvTenor>('30d');
  const [mode, setMode] = useState<SkewDisplayMode>('raw');

  const { data } = useIvHistory(underlying, window);
  const result = data?.tenors[tenor];
  const series = result?.series ?? [];

  const rrData = buildSkewLineData(series, 'rr25d', mode);
  const flyData = buildSkewLineData(series, 'bfly25d', mode);
  const rrLatestVal = latestSkewDisplayValue(series, 'rr25d', mode);
  const flyLatestVal = latestSkewDisplayValue(series, 'bfly25d', mode);
  const rrLatest = formatSkewDisplayValue(rrLatestVal, mode);
  const flyLatest = formatSkewDisplayValue(flyLatestVal, mode);
  const rrZone = zoneFor(rrLatestVal, mode);
  const flyZone = zoneFor(flyLatestVal, mode);
  const coverage = getHistoryCoverage(series, window, ['rr25d', 'bfly25d']);

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
          <span className={styles.toggleLabel}>MODE</span>
          <div className={styles.toggleGroup}>
            {DISPLAY_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={styles.toggleBtn}
                data-active={mode === m ? 'true' : undefined}
                onClick={() => setMode(m)}
              >
                {DISPLAY_LABELS[m]}
              </button>
            ))}
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
        <div className={styles.chartStack}>
          <SkewMiniChart
            title="25Δ RR"
            color={RR_COLOR}
            data={rrData}
            latest={rrLatest}
            mode={mode}
            zone={rrZone}
          />
          <SkewMiniChart
            title="25Δ Fly"
            color={FLY_COLOR}
            data={flyData}
            latest={flyLatest}
            mode={mode}
            zone={flyZone}
          />
        </div>
      </div>
    </div>
  );
}
