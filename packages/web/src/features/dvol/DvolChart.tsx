import { useRef, useEffect, useState } from 'react';
import {
  createChart,
  AreaSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  ColorType,
} from 'lightweight-charts';

import { useAppStore } from '@stores/app-store';
import { Spinner, EmptyState } from '@components/ui';
import { useStats } from '@features/chain/queries';
import { defineMessages, useT } from '@lib/i18n';
import { useDvolHistory } from './queries';
import styles from './DvolChart.module.css';

const CURRENCIES = ['BTC', 'ETH'] as const;

const messages = defineMessages(
  {
    unavailable: 'DVOL unavailable',
    unavailableDetail: 'DVOL index only exists for BTC and ETH on Deribit.',
    title: 'DVOL — Deribit Volatility Index',
    subtitle: '30-day ATM implied volatility',
    candles: ' · {n} daily candles',
    hv: 'HV (Realized)',
    current: 'Current',
    range: '52w Range',
    resetZoom: 'Reset zoom',
  },
  {
    unavailable: 'DVOL no disponible',
    unavailableDetail: 'El índice DVOL solo existe para BTC y ETH en Deribit.',
    title: 'DVOL — Índice de volatilidad de Deribit',
    subtitle: 'Volatilidad implícita ATM a 30 días',
    candles: ' · {n} velas diarias',
    hv: 'HV (realizada)',
    current: 'Actual',
    range: 'Rango 52s',
    resetZoom: 'Restablecer zoom',
  },
);

export default function DvolChart() {
  const t = useT(messages);
  const underlying = useAppStore((s) => s.underlying);
  const currency = CURRENCIES.includes(underlying as (typeof CURRENCIES)[number])
    ? underlying
    : 'BTC';

  const [selected, setSelected] = useState(currency);
  const { data, isLoading, error } = useDvolHistory(selected);
  const { data: stats } = useStats(selected);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const ivSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const hvSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

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
      grid: {
        vertLines: { color: '#1A1A1A' },
        horzLines: { color: '#1A1A1A' },
      },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
      rightPriceScale: {
        borderColor: '#1F2937',
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      timeScale: {
        borderColor: '#1F2937',
        timeVisible: false,
      },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    // DVOL (implied vol) — teal area
    const ivSeries = chart.addSeries(AreaSeries, {
      lineColor: '#50D2C1',
      topColor: 'rgba(80, 210, 193, 0.28)',
      bottomColor: 'rgba(80, 210, 193, 0.02)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(1)}%` },
    });

    // HV (realized vol) — solid orange line for IV vs HV comparison
    const hvSeries = chart.addSeries(LineSeries, {
      color: '#F7A600',
      lineWidth: 2,
      lineStyle: 0, // solid
      priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(1)}%` },
      crosshairMarkerVisible: false,
    });

    chartApiRef.current = chart;
    ivSeriesRef.current = ivSeries;
    hvSeriesRef.current = hvSeries;

    return () => {
      chart.remove();
      chartApiRef.current = null;
      ivSeriesRef.current = null;
      hvSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ivSeriesRef.current || !data?.candles.length) return;

    const seenIv = new Set<number>();
    const ivData = data.candles
      .map((c) => ({ time: Math.floor(c.timestamp / 1000) as number, value: c.close }))
      .filter((p) => {
        if (seenIv.has(p.time)) return false;
        seenIv.add(p.time);
        return true;
      })
      .sort((a, b) => a.time - b.time);
    ivSeriesRef.current.setData(ivData as never);

    // Overlay HV — Deribit sends duplicate timestamps, deduplicate and sort
    if (hvSeriesRef.current && data.hv?.length > 0) {
      const seen = new Set<number>();
      const hvData = data.hv
        .map((p) => ({ time: Math.floor(p.timestamp / 1000) as number, value: p.value }))
        .filter((p) => {
          if (seen.has(p.time)) return false;
          seen.add(p.time);
          return true;
        })
        .sort((a, b) => a.time - b.time);
      hvSeriesRef.current.setData(hvData as never);
    }

    chartApiRef.current?.timeScale().fitContent();
  }, [data]);

  const dvol = stats?.dvol;

  if (error && !data) {
    return (
      <div className={styles.view}>
        <EmptyState
          icon="⚠"
          title={t('unavailable')}
          detail={t('unavailableDetail')}
        />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{t('title')}</span>
            <div className={styles.picker}>
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  className={styles.pickerBtn}
                  data-active={c === selected}
                  onClick={() => setSelected(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <span className={styles.subtitle}>
            {t('subtitle')}
            {data ? t('candles', { n: data.count }) : ''}
          </span>
          <div className={styles.chartLegend}>
            <span className={styles.legendLine} data-type="iv" />
            <span className={styles.legendText}>IV (DVOL)</span>
            <span className={styles.legendLine} data-type="hv" />
            <span className={styles.legendText}>{t('hv')}</span>
          </div>
        </div>

        {dvol && (
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>{t('current')}</span>
              <span className={styles.statValue} data-accent>
                {(dvol.current * 100).toFixed(1)}%
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>IVP</span>
              <span className={styles.statValue}>{dvol.ivp.toFixed(0)}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>1d Δ</span>
              <span
                className={styles.statValue}
                data-positive={
                  dvol.ivChange1d > 0 ? 'true' : dvol.ivChange1d < 0 ? 'false' : undefined
                }
              >
                {dvol.ivChange1d > 0 ? '+' : ''}
                {(dvol.ivChange1d * 100).toFixed(1)}pp
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>{t('range')}</span>
              <span className={styles.statValue}>
                {(dvol.low52w * 100).toFixed(0)}%–{(dvol.high52w * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}
      </div>

      <div className={styles.chartArea}>
        {isLoading && (
          <div className={styles.chartOverlay}>
            <Spinner size="lg" />
          </div>
        )}
        <div className={styles.chartWrap} ref={chartRef} />
        <button
          className={styles.resetBtn}
          onClick={() => chartApiRef.current?.timeScale().fitContent()}
          title={t('resetZoom')}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
