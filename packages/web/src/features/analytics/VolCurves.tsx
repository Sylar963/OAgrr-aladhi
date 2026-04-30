import { useRef, useEffect, useMemo, useState } from 'react';
import {
  createChart,
  AreaSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  ColorType,
} from 'lightweight-charts';

import type { EnrichedChainResponse } from '@shared/enriched';
import { formatExpiry } from '@lib/format';
import { extractSmile } from '@lib/analytics/smile';
import styles from './AnalyticsView.module.css';

interface CurvePoint {
  strike: number;
  iv: number;
}

// Hue ramp: warm (red/orange) for near-dated, cool (blue/violet) for long-dated.
function tenorColor(idx: number, total: number): string {
  const hue = total <= 1 ? 160 : Math.round(10 + (270 * idx) / (total - 1));
  return `hsl(${hue}, 70%, 60%)`;
}

function withAlpha(hslColor: string, alpha: number): string {
  return hslColor.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

function buildPoints(chain: EnrichedChainResponse, spot: number | null): CurvePoint[] {
  if (spot != null && spot > 0) {
    const band = spot * 0.3;
    return extractSmile(chain.strikes, spot)
      .points.filter((p) => p.blendedIv != null && Math.abs(p.strike - spot) <= band)
      .map((p) => ({ strike: p.strike, iv: p.blendedIv! * 100 }))
      .sort((a, b) => a.strike - b.strike);
  }
  const points: CurvePoint[] = [];
  for (const strike of chain.strikes) {
    const ivs: number[] = [];
    for (const q of Object.values(strike.call.venues)) {
      if (q?.markIv != null) ivs.push(q.markIv);
    }
    for (const q of Object.values(strike.put.venues)) {
      if (q?.markIv != null) ivs.push(q.markIv);
    }
    if (ivs.length === 0) continue;
    points.push({ strike: strike.strike, iv: (ivs.reduce((a, b) => a + b, 0) / ivs.length) * 100 });
  }
  return points.sort((a, b) => a.strike - b.strike);
}

interface VolCurvesProps {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
}

export default function VolCurves({ chains, spotPrice }: VolCurvesProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Map<string, ISeriesApi<'Area'>>>(new Map());
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());

  const curves = useMemo(() => {
    const sorted = chains.filter((c) => c.strikes.length > 5).sort((a, b) => a.dte - b.dte);
    return sorted
      .map((chain, i) => ({
        expiry: chain.expiry,
        label: formatExpiry(chain.expiry),
        dte: chain.dte,
        color: tenorColor(i, sorted.length),
        points: buildPoints(chain, spotPrice),
      }))
      .filter((curve) => curve.points.length > 3);
  }, [chains, spotPrice]);

  const visibleCurves = useMemo(
    () => curves.filter((curve) => !hiddenExpiries.has(curve.expiry)),
    [curves, hiddenExpiries],
  );

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#555B5E',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#1A1A1A' }, horzLines: { color: '#1A1A1A' } },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: '#1F2937',
        tickMarkFormatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)),
      },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    seriesRefs.current.clear();
    for (const curve of visibleCurves) {
      const series = chart.addSeries(AreaSeries, {
        lineColor: curve.color,
        topColor: 'rgba(0,0,0,0)',
        bottomColor: 'rgba(0,0,0,0)',
        lineWidth: 2,
        priceFormat: { type: 'custom', formatter: (p: number) => `${p.toFixed(1)}%` },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      series.setData(
        curve.points.map((point) => ({
          time: point.strike as unknown as number,
          value: point.iv,
        })) as never,
      );
      seriesRefs.current.set(curve.expiry, series);
    }

    if (spotPrice != null && spotPrice > 0) {
      const spotLine = chart.addSeries(LineSeries, {
        color: 'rgba(85, 91, 94, 0.55)',
        lineWidth: 1,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null,
      });
      spotLine.setData([
        { time: spotPrice as unknown as number, value: 0 },
        { time: spotPrice as unknown as number, value: 1000 },
      ] as never);
    }

    chart.timeScale().fitContent();
    chartApi.current = chart;

    return () => {
      chart.remove();
      chartApi.current = null;
      seriesRefs.current.clear();
    };
  }, [visibleCurves, spotPrice]);

  const handleHover = (expiry: string | null) => {
    for (const curve of visibleCurves) {
      const series = seriesRefs.current.get(curve.expiry);
      if (!series) continue;
      if (expiry == null) {
        series.applyOptions({
          lineColor: curve.color,
          lineWidth: 2,
          topColor: 'rgba(0,0,0,0)',
          bottomColor: 'rgba(0,0,0,0)',
        });
      } else if (curve.expiry === expiry) {
        series.applyOptions({
          lineColor: curve.color,
          lineWidth: 3,
          topColor: withAlpha(curve.color, 0.18),
          bottomColor: withAlpha(curve.color, 0),
        });
      } else {
        series.applyOptions({
          lineColor: withAlpha(curve.color, 0.3),
          lineWidth: 2,
          topColor: 'rgba(0,0,0,0)',
          bottomColor: 'rgba(0,0,0,0)',
        });
      }
    }
  };

  if (curves.length === 0) return null;

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Implied Volatility Curves</div>
      <div className={styles.cardSubtitle}>OTM-blended mark IV per strike, all expiries</div>
      <div className={styles.curveLegend}>
        {curves.map((curve) => {
          const active = !hiddenExpiries.has(curve.expiry);
          return (
            <button
              key={curve.expiry}
              type="button"
              className={styles.curveLegendItem}
              data-active={active || undefined}
              onClick={() => {
                setHiddenExpiries((prev) => {
                  const next = new Set(prev);
                  if (next.has(curve.expiry)) next.delete(curve.expiry);
                  else next.add(curve.expiry);
                  return next;
                });
              }}
              onMouseEnter={() => handleHover(curve.expiry)}
              onMouseLeave={() => handleHover(null)}
            >
              <span className={styles.curveLegendDot} style={{ background: curve.color }} />
              {curve.label}
            </button>
          );
        })}
      </div>
      <div className={styles.curveChartArea}>
        <div className={styles.curveChartWrap} ref={chartRef} />
      </div>
    </div>
  );
}
