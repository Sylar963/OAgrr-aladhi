// packages/web/src/features/analytics/oi-by-strike/OiHeatmap.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

import type { EnrichedChainResponse } from '@shared/enriched';
import type { SpotCandleCurrency, SpotCandleResolutionSec } from '@shared/common';
import { fmtUsdCompact, fmtCompact, formatExpiry } from '@lib/format';

import styles from '../AnalyticsView.module.css';
import { HeatBandPrimitive } from './HeatBandPrimitive';
import {
  aggregateHeatRows,
  aggregateStrikeOi,
  computeMaxPain,
  type HeatSide,
  type OiMode,
  type StrikeOi,
} from './oi-heatmap-utils';
import { useSpotCandles } from './queries';

const EXPIRY_COLORS = [
  '#00E997', '#CB3855', '#50D2C1', '#F0B90B', '#0052FF',
  '#F7A600', '#25FAAF', '#8B5CF6', '#EC4899', '#6366F1',
  '#A855F7', '#14B8A6',
];

type TimeRange = '24h' | '7d' | '30d';

interface RangeParams {
  resolution: SpotCandleResolutionSec;
  buckets: number;
}

const TIME_RANGE: Record<TimeRange, RangeParams> = {
  '24h': { resolution: 1800,  buckets: 48 },
  '7d':  { resolution: 3600,  buckets: 168 },
  '30d': { resolution: 14400, buckets: 180 },
};

interface Props {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
  currency: SpotCandleCurrency;
}

export default function OiHeatmap({ chains, spotPrice, currency }: Props) {
  const [mode, setMode] = useState<OiMode>('contracts');
  const [side, setSide] = useState<HeatSide>('both');
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(new Set());
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const didFitRef = useRef(false);
  const primitiveRef = useRef<HeatBandPrimitive | null>(null);
  const strikeLinesRef = useRef<Map<number, IPriceLine>>(new Map());
  const spotLineRef = useRef<IPriceLine | null>(null);
  const maxPainLineRef = useRef<IPriceLine | null>(null);

  const range = TIME_RANGE[timeRange];
  const { data: candleData, isLoading: candlesLoading, error: candlesError, refetch } =
    useSpotCandles(currency, range.resolution, range.buckets);

  const sortedExpiries = useMemo(() => chains.map((c) => c.expiry).sort(), [chains]);
  const expiryColorMap = useMemo(
    () => new Map(sortedExpiries.map((exp, i) => [exp, EXPIRY_COLORS[i % EXPIRY_COLORS.length]!])),
    [sortedExpiries],
  );

  const heatRows = useMemo(
    () => aggregateHeatRows(chains, spotPrice, mode, hiddenExpiries, side),
    [chains, spotPrice, mode, hiddenExpiries, side],
  );

  // Tooltip needs venue/expiry breakdown (re-uses V1 aggregation).
  const fullStrikeData = useMemo(
    () => aggregateStrikeOi(
      chains.filter((c) => !hiddenExpiries.has(c.expiry)),
      spotPrice,
      mode,
    ),
    [chains, hiddenExpiries, spotPrice, mode],
  );

  const maxPain = useMemo(
    () => computeMaxPain(chains.filter((c) => !hiddenExpiries.has(c.expiry))),
    [chains, hiddenExpiries],
  );

  // Keep latest heatRows in a ref so the crosshair callback (registered once at mount)
  // can read fresh data without re-subscribing.
  const heatRowsRef = useRef(heatRows);
  useEffect(() => { heatRowsRef.current = heatRows; }, [heatRows]);

  // ── Chart lifecycle (mount/unmount only) ────────────────────────
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
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
        vertLine: { color: '#50D2C1', labelBackgroundColor: '#0E3333' },
      },
    });

    const series: ISeriesApi<'Candlestick', Time> = chart.addSeries(CandlestickSeries, {
      upColor: '#00E997',
      downColor: '#CB3855',
      wickUpColor: '#00E997',
      wickDownColor: '#CB3855',
      borderVisible: false,
      priceLineVisible: false,
    }) as ISeriesApi<'Candlestick', Time>;

    const primitive = new HeatBandPrimitive();
    series.attachPrimitive(primitive);

    chartRef.current = chart;
    seriesRef.current = series;
    primitiveRef.current = primitive;

    chart.subscribeCrosshairMove((param) => {
      if (param.point === undefined || param.time === undefined) {
        setHoveredStrike(null);
        setTooltipPos(null);
        return;
      }
      const price = series.coordinateToPrice(param.point.y);
      if (price === null) return;
      let nearest: number | null = null;
      let bestDist = Infinity;
      for (const row of heatRowsRef.current) {
        const d = Math.abs(row.strike - price);
        if (d < bestDist) { bestDist = d; nearest = row.strike; }
      }
      setHoveredStrike(nearest);
      setTooltipPos({ x: param.point.x, y: param.point.y });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      primitiveRef.current = null;
      strikeLinesRef.current.clear();
      spotLineRef.current = null;
      maxPainLineRef.current = null;
    };
  }, []);

  // Reset fit guard when the user picks a different time range or switches
  // underlying so fitContent fires once for the new data set.
  useEffect(() => {
    didFitRef.current = false;
  }, [timeRange, currency]);

  // ── Push candle data ──────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !candleData) return;
    const data = candleData.candles.map((c) => ({
      time: Math.floor(c.timestamp / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(data);
    if (!didFitRef.current && data.length > 0) {
      chartRef.current?.timeScale().fitContent();
      didFitRef.current = true;
    }
  }, [candleData]);

  // ── Push heat rows to the primitive ───────────────────────────
  useEffect(() => {
    primitiveRef.current?.update(heatRows);
  }, [heatRows]);

  // ── Diff strike axis labels (avoid flicker) ───────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const next = new Set(heatRows.map((r) => r.strike));
    const lines = strikeLinesRef.current;

    for (const [strike, line] of lines.entries()) {
      if (!next.has(strike)) {
        series.removePriceLine(line);
        lines.delete(strike);
      }
    }
    for (const row of heatRows) {
      if (lines.has(row.strike)) continue;
      const line = series.createPriceLine({
        price: row.strike,
        color: 'transparent',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        lineVisible: false,
        axisLabelVisible: true,
        title: row.strike.toLocaleString(),
        axisLabelColor: row.dominant === 'call' ? '#0E3D2C' : '#3D0E1A',
        axisLabelTextColor: row.dominant === 'call' ? '#00E997' : '#CB3855',
      });
      lines.set(row.strike, line);
    }
  }, [heatRows]);

  // ── SPOT and MP price lines ───────────────────────────────────
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
        color: '#50D2C1',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `${Math.round(spotPrice).toLocaleString()} SPOT`,
      });
    }
  }, [spotPrice]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (maxPainLineRef.current) {
      series.removePriceLine(maxPainLineRef.current);
      maxPainLineRef.current = null;
    }
    if (maxPain != null) {
      maxPainLineRef.current = series.createPriceLine({
        price: maxPain,
        color: '#F0B90B',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${maxPain.toLocaleString()} MP`,
      });
    }
  }, [maxPain]);

  const toggleExpiry = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const next = new Set(prev);
      if (next.has(expiry)) next.delete(expiry);
      else next.add(expiry);
      return next;
    });
  };

  const fmt = mode === 'notional' ? fmtUsdCompact : fmtCompact;
  const hovered = hoveredStrike != null
    ? fullStrikeData.find((s) => s.strike === hoveredStrike) ?? null
    : null;
  const allHidden = hiddenExpiries.size > 0 && hiddenExpiries.size === sortedExpiries.length;

  return (
    <div>
      <div className={styles.heatControls}>
        <div className={styles.oiToggle}>
          <button className={styles.oiToggleBtn} data-active={mode === 'contracts' || undefined} onClick={() => setMode('contracts')}>Contracts</button>
          <button className={styles.oiToggleBtn} data-active={mode === 'notional'  || undefined} onClick={() => setMode('notional')}>Notional</button>
        </div>
        <div className={styles.oiToggle}>
          <button className={styles.oiToggleBtn} data-active={side === 'calls' || undefined} onClick={() => setSide('calls')}>Calls</button>
          <button className={styles.oiToggleBtn} data-active={side === 'puts'  || undefined} onClick={() => setSide('puts')}>Puts</button>
          <button className={styles.oiToggleBtn} data-active={side === 'both'  || undefined} onClick={() => setSide('both')}>Both</button>
        </div>
        <div className={styles.oiToggle}>
          {(['24h', '7d', '30d'] as TimeRange[]).map((r) => (
            <button key={r} className={styles.oiToggleBtn} data-active={timeRange === r || undefined} onClick={() => setTimeRange(r)}>{r}</button>
          ))}
        </div>
      </div>

      <div className={styles.curveLegend}>
        {sortedExpiries.map((expiry) => {
          const active = !hiddenExpiries.has(expiry);
          return (
            <button
              key={expiry}
              type="button"
              className={styles.curveLegendItem}
              data-active={active || undefined}
              onClick={() => toggleExpiry(expiry)}
            >
              <span className={styles.curveLegendDot} style={{ background: expiryColorMap.get(expiry) }} />
              {formatExpiry(expiry)}
            </button>
          );
        })}
      </div>

      <div className={styles.heatChartWrap}>
        <div className={styles.heatChartCanvas} ref={containerRef} />

        {candlesLoading && !candleData && (
          <div className={styles.heatStatusOverlay}>Loading spot history…</div>
        )}
        {candlesError && (
          <div className={styles.heatStatusOverlay}>
            <div>Spot history unavailable</div>
            <button onClick={() => void refetch()}>Retry</button>
          </div>
        )}
        {allHidden && (
          <div className={styles.heatStatusOverlay}>
            All expiries hidden — re-enable one in the legend above.
          </div>
        )}

        {hovered && tooltipPos && (
          <HeatTooltip
            data={hovered}
            tooltipPos={tooltipPos}
            expiryColorMap={expiryColorMap}
            fmt={fmt}
          />
        )}
      </div>
    </div>
  );
}

function HeatTooltip({
  data,
  tooltipPos,
  expiryColorMap,
  fmt,
}: {
  data: StrikeOi;
  tooltipPos: { x: number; y: number };
  expiryColorMap: Map<string, string>;
  fmt: (v: number | null | undefined) => string;
}) {
  return (
    <div
      className={styles.oiTooltip}
      style={{ left: tooltipPos.x + 16, top: tooltipPos.y - 8 }}
    >
      <div className={styles.oiTooltipTitle}>{data.strike.toLocaleString()}</div>
      <div className={styles.oiTooltipColumns}>
        {data.venues.length > 0 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Venue</div>
            <div className={styles.oiTooltipHeader}><span /><span>Calls</span><span>Puts</span></div>
            {data.venues.map((v) => (
              <div key={v.venue} className={styles.oiTooltipRow}>
                <span className={styles.oiTooltipVenue}>{v.venue}</span>
                <span className={styles.oiCall}>{fmt(v.callOi)}</span>
                <span className={styles.oiPut}>{fmt(v.putOi)}</span>
              </div>
            ))}
          </div>
        )}
        {data.expiries.length > 1 && (
          <div className={styles.oiTooltipCol}>
            <div className={styles.oiTooltipSection}>By Expiry</div>
            <div className={styles.oiTooltipHeader}><span /><span>Calls</span><span>Puts</span></div>
            {data.expiries.map((ep) => (
              <div key={ep.expiry} className={styles.oiTooltipRow}>
                <span className={styles.oiTooltipVenue}>
                  <span className={styles.oiTooltipDot} style={{ background: expiryColorMap.get(ep.expiry) }} />
                  {ep.expiry}
                </span>
                <span className={styles.oiCall}>{fmt(ep.callOi)}</span>
                <span className={styles.oiPut}>{fmt(ep.putOi)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
