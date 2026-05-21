import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  AreaSeries,
  LineSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { AttributionPoint, AttributionResult } from './pnl-attribution.js';
import { pickPriceFormat } from './chart-precision.js';
import styles from './InstrumentAttributionChart.module.css';

interface Props {
  result: AttributionResult;
  priceCurrency: string;
}

interface HoverState {
  ts: number;
  total: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  residual: number;
}

// Cumulative series for each contributor + the realized total PL.
function buildCumulative(points: readonly AttributionPoint[]) {
  let total = 0, d = 0, g = 0, t = 0, v = 0, r = 0;
  const series = {
    total: [] as { time: Time; value: number }[],
    delta: [] as { time: Time; value: number }[],
    gamma: [] as { time: Time; value: number }[],
    theta: [] as { time: Time; value: number }[],
    vega:  [] as { time: Time; value: number }[],
    residual: [] as { time: Time; value: number }[],
  };
  for (const p of points) {
    total += p.totalPL;
    d += p.deltaPL; g += p.gammaPL; t += p.thetaPL; v += p.vegaPL; r += p.residualPL;
    const time = (p.ts / 1000) as Time;
    series.total.push({ time, value: total });
    series.delta.push({ time, value: d });
    series.gamma.push({ time, value: g });
    series.theta.push({ time, value: t });
    series.vega.push({ time, value: v });
    series.residual.push({ time, value: r });
  }
  return series;
}

export default function InstrumentAttributionChart({ result, priceCurrency }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const totalRef = useRef<ISeriesApi<'Area', Time> | null>(null);
  const deltaRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const gammaRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const thetaRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const vegaRef  = useRef<ISeriesApi<'Line', Time> | null>(null);
  const residualRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9aa0a6',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    totalRef.current = chart.addSeries(AreaSeries, {
      lineColor: '#94b3fd',
      topColor: 'rgba(148, 179, 253, 0.3)',
      bottomColor: 'rgba(148, 179, 253, 0)',
      lineWidth: 2,
      priceLineVisible: false,
    });
    const mkLine = (color: string) => chart.addSeries(LineSeries, {
      color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    });
    deltaRef.current = mkLine('#60A5FA');
    gammaRef.current = mkLine('#FBBF24');
    thetaRef.current = mkLine('#F87171');
    vegaRef.current = mkLine('#A855F7');
    residualRef.current = mkLine('#9aa0a6');

    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  // Pre-compute the cumulative series whenever the result changes.
  const cumulative = useMemo(() => buildCumulative(result.points), [result.points]);

  // Push data into each series + adapt y-axis precision. Sub-$1 cumulative
  // PL would otherwise round to a 2-decimal grid and collapse small moves
  // onto a single horizontal line (Deribit BTC inverse, untraded altcoins).
  useEffect(() => {
    totalRef.current?.setData(cumulative.total);
    deltaRef.current?.setData(cumulative.delta);
    gammaRef.current?.setData(cumulative.gamma);
    thetaRef.current?.setData(cumulative.theta);
    vegaRef.current?.setData(cumulative.vega);
    residualRef.current?.setData(cumulative.residual);

    let maxAbs = 0;
    for (const arr of [
      cumulative.total, cumulative.delta, cumulative.gamma,
      cumulative.theta, cumulative.vega, cumulative.residual,
    ]) {
      for (const { value } of arr) {
        const a = Math.abs(value);
        if (a > maxAbs) maxAbs = a;
      }
    }
    const { precision, minMove } = pickPriceFormat(maxAbs);
    const priceFormat = { type: 'price' as const, precision, minMove };
    totalRef.current?.applyOptions({ priceFormat });
    deltaRef.current?.applyOptions({ priceFormat });
    gammaRef.current?.applyOptions({ priceFormat });
    thetaRef.current?.applyOptions({ priceFormat });
    vegaRef.current?.applyOptions({ priceFormat });
    residualRef.current?.applyOptions({ priceFormat });
  }, [cumulative]);

  // Hover handler — map crosshair time back to the matching AttributionPoint.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const byTime = new Map<number, AttributionPoint>(
      result.points.map((p) => [Math.floor(p.ts / 1000), p]),
    );
    const handler = (p: { time?: Time }) => {
      if (p.time == null || typeof p.time !== 'number') { setHover(null); return; }
      const point = byTime.get(p.time);
      if (!point) { setHover(null); return; }
      setHover({
        ts: point.ts,
        total: point.totalPL,
        delta: point.deltaPL,
        gamma: point.gammaPL,
        theta: point.thetaPL,
        vega: point.vegaPL,
        residual: point.residualPL,
      });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [result.points]);

  return (
    <div className={styles.wrap}>
      {hover && (
        <div className={styles.tooltip}>
          <div className={styles.row}><span>Total</span><span>{fmt(hover.total, priceCurrency)}</span></div>
          <div className={styles.row} data-greek="delta"><span>Δ</span><span>{fmt(hover.delta, priceCurrency)}</span></div>
          <div className={styles.row} data-greek="gamma"><span>Γ</span><span>{fmt(hover.gamma, priceCurrency)}</span></div>
          <div className={styles.row} data-greek="theta"><span>Θ</span><span>{fmt(hover.theta, priceCurrency)}</span></div>
          <div className={styles.row} data-greek="vega"><span>V</span><span>{fmt(hover.vega, priceCurrency)}</span></div>
          <div className={styles.row} data-greek="residual"><span>res</span><span>{fmt(hover.residual, priceCurrency)}</span></div>
        </div>
      )}
      <div ref={containerRef} className={styles.chart} />
    </div>
  );
}

function fmt(value: number, currency: string): string {
  const abs = Math.abs(value);
  const prefix = value < 0 ? '−' : '';
  if (currency === 'BTC' || currency === 'ETH') return `${prefix}${abs.toFixed(4)}`;
  if (abs >= 1) return `${prefix}${abs.toFixed(2)}`;
  return `${prefix}${abs.toFixed(4)}`;
}
