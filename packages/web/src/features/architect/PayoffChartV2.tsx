import { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';

import { Spinner } from '@components/ui';
import type { Leg } from './payoff';
import { pnlAtPrice } from './payoff';
import { dteDays, fmtUsd } from '@lib/format';
import { defineMessages, useLocale, useT } from '@lib/i18n';
import type { SpotCandle } from './queries';
import { ZonesPrimitive, type PriceZone } from './zones-primitive';
import type { GhostPath, RealizedReading } from './ghost-paths';
import type { ProfitFrontier } from './profit-frontiers';
import { ExpiryLinesPrimitive, type VerticalLinePalette } from './expiry-lines-primitive';
import { findBreakevenCrossing, fmtDayMonth, type ExpiryMark } from './expiry-timeline';
import styles from './Architect.module.css';

const GHOST_RGB: Record<'profit' | 'loss', string> = {
  profit: '0,233,151',
  loss: '203,56,85',
};
const SNAP_RGB = '179,157,255';
const SNAP_PALETTE: VerticalLinePalette = {
  strong: `rgb(${SNAP_RGB})`,
  muted: `rgba(${SNAP_RGB},0.5)`,
  strongBg: 'rgba(36, 28, 64, 0.92)',
  mutedBg: 'rgba(26, 22, 40, 0.85)',
  labelTop: 26,
};
/** Snapshot break-evens within this fraction of a live one are already drawn. */
const BE_MATCH_TOL = 0.0025;
const SAME_EXPIRY_MS = 3_600_000;
const MS_PER_DAY = 86_400_000;
const messages = defineMessages(
  {
    ghost_up: '↑ up',
    ghost_down: '↓ down',
    ghost_theta: 'θ flat',
    invalid: 'INVALID',
    noHistory: 'No spot price history for this underlying',
    v1Accurate: 'The V1 expiry view stays accurate.',
    switchToV1: 'Switch back to V1',
    snapshotAgo: 'snapshot · {ago}',
    live: 'live',
    snapshotAnchor: '⎙ {ago} · {spot}',
    snapshotExpiry: '⎙ EXP {date}',
    snapBe: 'BE ⎙',
    realized: 'realized {sigma}σ · near {path}',
    realizedAtExpiry: 'at expiry {sigma}σ · near {path}',
    profitFrontier: 'PROFIT FRONTIER',
    ivShift: 'IV {iv}% ({shift} pts)',
    frontierNote: 'Above = modeled profit before exit costs',
  },
  {
    ghost_up: '↑ alza',
    ghost_down: '↓ baja',
    ghost_theta: 'θ plano',
    invalid: 'INVÁLIDO',
    noHistory: 'Sin historial de precio spot para este subyacente',
    v1Accurate: 'La vista de vencimiento V1 sigue siendo precisa.',
    switchToV1: 'Volver a V1',
    snapshotAgo: 'captura · {ago}',
    live: 'en vivo',
    snapshotAnchor: '⎙ {ago} · {spot}',
    snapshotExpiry: '⎙ VTO {date}',
    snapBe: 'BE ⎙',
    realized: 'realizado {sigma}σ · cerca de {path}',
    realizedAtExpiry: 'al vencimiento {sigma}σ · cerca de {path}',
    profitFrontier: 'FRONTERA DE GANANCIA',
    ivShift: 'IV {iv}% ({shift} pts)',
    frontierNote: 'Arriba = ganancia modelada antes de costos de salida',
  },
);
const rgba = (rgb: string, a: number) => `rgba(${rgb},${a})`;

interface PayoffChartV2Props {
  candles: SpotCandle[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  resolutionSec: number;
  loading: boolean;
  available: boolean;
  onSwitchToV1: () => void;
  projections: ProjectionSet[];
  snapshot: SnapshotOverlay | null;
  showProjections: boolean;
  projectionKey: string;
  profitFrontiers: ProfitFrontier[];
  expiryMarks: ExpiryMark[];
  invalidationLevel?: number | null;
}

/** One set of up/down/θ paths with the break-evens and expiry it was built against. */
export interface ProjectionSet {
  id: 'live' | 'snapshot';
  paths: GhostPath[];
  breakevens: number[];
  expiryMs: number;
}

export interface SnapshotOverlay {
  anchorMs: number;
  spot: number;
  agoLabel: string;
  breakevens: number[];
  expiryMs: number;
  realized: RealizedReading | null;
}

export interface CandleSpec {
  resolutionSec: number;
  buckets: number;
  rangeLabel: string;
  intervalLabel: string;
  refetchIntervalMs: number;
}

/**
 * Pick a candle window that scales with the strategy's nearest-leg DTE.
 * Bucket counts stay on fixed tiers so small tenor edits reuse the same query
 * key. That keeps the history cache warm and avoids unnecessary upstream
 * refetches while the user fine-tunes a structure.
 */
export function pickCandleSpec(legs: Leg[]): CandleSpec {
  if (legs.length === 0) {
    return {
      resolutionSec: 3600,
      buckets: 24,
      rangeLabel: '1D',
      intervalLabel: '1H',
      refetchIntervalMs: 60_000,
    };
  }
  const minDte = Math.max(0, Math.min(...legs.map((l) => dteDays(l.expiry))));

  // Bucket counts are 3× the bars a tenor strictly needs so the chart carries
  // deep historical context (e.g. ~2 months at a 30d structure, ~18 months at
  // the longest expiry). Deribit/Hyperliquid windows are time-ranged, not
  // bar-capped, and the /spot-candles route allows up to 3000 buckets, so the
  // wider windows just return more bars (verified: 92d of 1h ≈ 2.2k ticks).
  if (minDte < 1) {
    return {
      resolutionSec: 300,
      buckets: 144,
      rangeLabel: '12H',
      intervalLabel: '5M',
      refetchIntervalMs: 15_000,
    };
  }
  if (minDte < 3) {
    return {
      resolutionSec: 1800,
      buckets: 288,
      rangeLabel: '6D',
      intervalLabel: '30M',
      refetchIntervalMs: 30_000,
    };
  }
  if (minDte < 14) {
    return {
      resolutionSec: 3600,
      buckets: minDte < 7 ? 288 : 504,
      rangeLabel: minDte < 7 ? '12D' : '21D',
      intervalLabel: '1H',
      refetchIntervalMs: 60_000,
    };
  }
  if (minDte < 60) {
    return {
      resolutionSec: 14400,
      buckets: minDte < 30 ? 270 : 540,
      rangeLabel: minDte < 30 ? '45D' : '90D',
      intervalLabel: '4H',
      refetchIntervalMs: 120_000,
    };
  }
  return {
    resolutionSec: 86400,
    buckets: minDte < 120 ? 270 : 540,
    rangeLabel: minDte < 120 ? '270D' : '540D',
    intervalLabel: '1D',
    refetchIntervalMs: 300_000,
  };
}

function buildZones(legs: Leg[], breakevens: number[], spotPrice: number): PriceZone[] {
  if (legs.length === 0) return [];

  if (breakevens.length === 0) {
    const sign = pnlAtPrice(legs, spotPrice) >= 0;
    return [{ low: -Infinity, high: Infinity, profit: sign }];
  }

  const sorted = [...breakevens].sort((a, b) => a - b);
  const zones: PriceZone[] = [];
  const boundaries = [-Infinity, ...sorted, Infinity];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const low = boundaries[i]!;
    const high = boundaries[i + 1]!;
    let probe: number;
    if (Number.isFinite(low) && Number.isFinite(high)) {
      probe = (low + high) / 2;
    } else if (Number.isFinite(high)) {
      probe = (high as number) * 0.5;
    } else if (Number.isFinite(low)) {
      probe = (low as number) * 1.5;
    } else {
      probe = spotPrice;
    }
    zones.push({ low, high, profit: pnlAtPrice(legs, probe) >= 0 });
  }
  return zones;
}

export default function PayoffChartV2({
  candles,
  breakevens,
  spotPrice,
  legs,
  resolutionSec,
  loading,
  available,
  onSwitchToV1,
  projections,
  snapshot,
  showProjections,
  projectionKey,
  profitFrontiers,
  expiryMarks,
  invalidationLevel = null,
}: PayoffChartV2Props) {
  const t = useT(messages);
  const locale = useLocale();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const primitiveRef = useRef<ZonesPrimitive | null>(null);
  const expiryLinesRef = useRef<ExpiryLinesPrimitive | null>(null);
  const snapshotLinesRef = useRef<ExpiryLinesPrimitive | null>(null);
  const anchorMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastWindowKeyRef = useRef<string>('');
  // Keyed `${set}:${kind}`.
  const ghostSeriesRef = useRef(new Map<string, ISeriesApi<'Candlestick'>>());
  const ghostMarkersRef = useRef(new Map<string, ISeriesMarkersPluginApi<Time>>());
  const ghostTagsRef = useRef<{ series: ISeriesApi<'Candlestick'>; line: IPriceLine }[]>([]);
  const frontierSeriesRef = useRef(new Map<ProfitFrontier['kind'], ISeriesApi<'Line'>>());
  const lastGhostFitKeyRef = useRef<string>('');

  const zones = useMemo(
    () => buildZones(legs, breakevens, spotPrice),
    [legs, breakevens, spotPrice],
  );

  // Init chart once.
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
        horzLine: { color: '#CB3855', labelBackgroundColor: '#3A1620' },
        vertLine: { color: '#CB3855', labelBackgroundColor: '#3A1620' },
      },
      rightPriceScale: {
        borderColor: '#1F2937',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#1F2937',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00E997',
      downColor: '#CB3855',
      borderUpColor: '#00E997',
      borderDownColor: '#CB3855',
      wickUpColor: '#00E997',
      wickDownColor: '#CB3855',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });

    const primitive = new ZonesPrimitive();
    series.attachPrimitive(primitive);
    const expiryLines = new ExpiryLinesPrimitive();
    series.attachPrimitive(expiryLines);
    const snapshotLines = new ExpiryLinesPrimitive(SNAP_PALETTE);
    series.attachPrimitive(snapshotLines);

    chartApiRef.current = chart;
    seriesRef.current = series;
    primitiveRef.current = primitive;
    expiryLinesRef.current = expiryLines;
    snapshotLinesRef.current = snapshotLines;
    anchorMarkersRef.current = createSeriesMarkers(series, []);

    return () => {
      chart.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      primitiveRef.current = null;
      expiryLinesRef.current = null;
      snapshotLinesRef.current = null;
      anchorMarkersRef.current = null;
      lastWindowKeyRef.current = '';
      ghostSeriesRef.current.clear();
      ghostMarkersRef.current.clear();
      ghostTagsRef.current = [];
      frontierSeriesRef.current.clear();
      lastGhostFitKeyRef.current = '';
    };
  }, []);

  // Only fit-content when the history window changes so refreshes preserve any
  // zoom or pan the user has applied.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartApiRef.current;
    if (!series || !chart || candles.length === 0) return;

    const seen = new Set<number>();
    const data = candles
      .map((c) => ({
        time: Math.floor(c.timestamp / 1000) as number,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .filter((p) => {
        if (seen.has(p.time)) return false;
        seen.add(p.time);
        return true;
      })
      .sort((a, b) => a.time - b.time);
    series.setData(data as never);

    // A "fresh window" is the first load or a structural reset of the data
    // window (resolution change or strategy swap). We detect those by a shrink
    // in length or a backwards jump in the first timestamp; pure rolling
    // updates only nudge the first timestamp forward and grow length.
    const first = data[0]!.time as number;
    const windowKey = `${resolutionSec}:${first}:${data.length}`;
    const prev = lastWindowKeyRef.current;
    let isFresh = prev === '';
    if (!isFresh) {
      const [prevResolutionStr, prevFirstStr, prevLenStr] = prev.split(':');
      const prevResolution = Number(prevResolutionStr);
      const prevFirst = Number(prevFirstStr);
      const prevLen = Number(prevLenStr);
      isFresh = prevResolution !== resolutionSec || first < prevFirst || data.length < prevLen;
    }
    if (isFresh) {
      chart.timeScale().fitContent();
    }
    lastWindowKeyRef.current = windowKey;
  }, [candles, resolutionSec]);

  // Apply break-even price lines.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];

    for (const be of breakevens) {
      const line = series.createPriceLine({
        price: be,
        color: '#F0B90B',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'BE',
      });
      priceLinesRef.current.push(line);
    }

    if (spotPrice > 0) {
      const spotLine = series.createPriceLine({
        price: spotPrice,
        color: '#F0B90B66',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: false,
        title: 'spot',
      });
      priceLinesRef.current.push(spotLine);
    }

    if (snapshot && showProjections) {
      for (const be of snapshot.breakevens) {
        if (breakevens.some((live) => Math.abs(live - be) <= live * BE_MATCH_TOL)) continue;
        const line = series.createPriceLine({
          price: be,
          color: rgba(SNAP_RGB, 0.7),
          lineWidth: 1,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: t('snapBe'),
        });
        priceLinesRef.current.push(line);
      }
    }

    if (invalidationLevel != null && invalidationLevel > 0) {
      const thesisLine = series.createPriceLine({
        price: invalidationLevel,
        color: '#FEF9A0',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: t('invalid'),
      });
      priceLinesRef.current.push(thesisLine);
    }
  }, [breakevens, spotPrice, invalidationLevel, snapshot, showProjections, t]);

  // Push zones to the chart-canvas primitive. The primitive itself recomputes
  // pixel coordinates on every chart redraw via updateAllViews, so there is
  // nothing to wire up to pan/zoom or resize events here.
  useEffect(() => {
    primitiveRef.current?.setZones(zones);
  }, [zones]);

  // Render the projection paths as translucent candlestick series. Each series'
  // future data points extend the shared time scale into the projection region.
  // Series are kept per key and updated in place: removing and re-adding them
  // on every spot tick shrinks/grows the time scale's base index, which makes
  // lightweight-charts shift the visible range and undo the user's pan/zoom.
  // A snapshot's stretch inside the real-candle window is hindsight and only adds
  // noise over the real candles, so just its forward part is drawn.
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;

    const timeScale = chart.timeScale();
    const shouldFit = projectionKey !== lastGhostFitKeyRef.current;
    const preservedRange = shouldFit ? null : timeScale.getVisibleLogicalRange();
    const lastRealMs = candles.at(-1)?.timestamp ?? -Infinity;
    const toSec = (ms: number) => Math.floor(ms / 1000);

    for (const tag of ghostTagsRef.current) tag.series.removePriceLine(tag.line);
    ghostTagsRef.current = [];

    const active = new Set<string>();
    const markers = new Map<string, SeriesMarker<Time>[]>();
    // Paths leaving spot together cross the same break-even on the same day;
    // label only the first so the texts don't stack on top of each other.
    const labelledDays = new Set<number>();
    if (showProjections) {
      for (const set of projections) {
        const muted = set.id === 'snapshot';
        for (const path of set.paths) {
          if (path.candles.length === 0) continue;
          const key = `${set.id}:${path.kind}`;
          const rgb = path.isProfit ? GHOST_RGB.profit : GHOST_RGB.loss;
          const bodyAlpha = (path.kind === 'theta' ? 0.18 : 0.3) * (muted ? 0.55 : 1);
          const edgeAlpha = muted ? 0.32 : 0.55;
          const style = {
            upColor: rgba(rgb, bodyAlpha),
            downColor: rgba(rgb, bodyAlpha),
            borderUpColor: rgba(rgb, edgeAlpha),
            borderDownColor: rgba(rgb, edgeAlpha),
            wickUpColor: rgba(rgb, edgeAlpha),
            wickDownColor: rgba(rgb, edgeAlpha),
          };
          let series = ghostSeriesRef.current.get(key);
          if (series) {
            series.applyOptions(style);
          } else {
            series = chart.addSeries(CandlestickSeries, {
              ...style,
              priceLineVisible: false,
              lastValueVisible: false,
            });
            ghostSeriesRef.current.set(key, series);
            ghostMarkersRef.current.set(key, createSeriesMarkers(series, []));
          }
          const future = path.candles.filter((c) => c.timestamp > lastRealMs);
          series.setData(
            future.map((c) => ({
              time: toSec(c.timestamp), // seconds — match the main series
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            })) as never,
          );
          active.add(key);

          const crossing = findBreakevenCrossing(
            path.candles,
            set.breakevens,
            Number.isFinite(set.expiryMs) ? set.expiryMs : path.candles.at(-1)!.timestamp,
            locale,
          );
          if (crossing && crossing.timestamp > lastRealMs) {
            const day = Math.floor(crossing.timestamp / MS_PER_DAY);
            const list = markers.get(key) ?? [];
            list.push({
              time: toSec(crossing.timestamp) as Time,
              position: path.targetPrice >= path.candles[0]!.open ? 'aboveBar' : 'belowBar',
              shape: 'circle',
              color: rgba(rgb, muted ? 0.7 : 0.9),
              text: labelledDays.has(day) ? '' : crossing.label,
              size: 0.6,
            });
            markers.set(key, list);
            labelledDays.add(day);
          }

          if (future.length > 0) {
            ghostTagsRef.current.push({
              series,
              line: series.createPriceLine({
                price: path.targetPrice,
                color: rgba(rgb, muted ? 0.55 : 0.9),
                lineVisible: false,
                axisLabelVisible: true,
                axisLabelColor: rgba(rgb, muted ? 0.4 : 0.85),
                axisLabelTextColor: '#0A0A0A',
                title: `${muted ? '⎙ ' : ''}${t(`ghost_${path.kind}`)} ${fmtUsd(path.pnlAtExpiry)}`,
              }),
            });
          }
        }
      }
    }
    for (const [key, plugin] of ghostMarkersRef.current) plugin.setMarkers(markers.get(key) ?? []);
    for (const [key, series] of ghostSeriesRef.current) {
      if (!active.has(key)) series.setData([]);
    }

    // Bring the projection into view only when the projection identity changes
    // (toggle on, snapshot switch, tenor/resolution change) — not on every tick,
    // so the user's pan/zoom is preserved during rolling updates.
    if (shouldFit) {
      timeScale.fitContent();
      lastGhostFitKeyRef.current = projectionKey;
    } else if (preservedRange) {
      timeScale.setVisibleLogicalRange(preservedRange);
    }
  }, [projections, showProjections, projectionKey, candles, locale, t]);

  // Expiry lines are positioned off the last time point on the shared scale,
  // which the projection and frontier series extend past the last real candle.
  useEffect(() => {
    let lastMs = candles.at(-1)?.timestamp ?? null;
    if (showProjections) {
      const extents = [
        ...projections.flatMap((set) => set.paths.map((p) => p.candles.at(-1)?.timestamp)),
        ...profitFrontiers.map((f) => f.points.at(-1)?.timestamp),
      ];
      for (const t of extents) if (t != null && (lastMs == null || t > lastMs)) lastMs = t;
    }
    const lastSec = lastMs == null ? null : Math.floor(lastMs / 1000);
    expiryLinesRef.current?.setMarks(expiryMarks, lastSec, resolutionSec);

    const snapshotMarks: ExpiryMark[] = [];
    if (snapshot && showProjections) {
      snapshotMarks.push({
        expiryMs: snapshot.anchorMs,
        label: t('snapshotAnchor', { ago: snapshot.agoLabel, spot: fmtUsd(snapshot.spot) }),
        nearest: true,
      });
      const liveExpiryMs = expiryMarks[0]?.expiryMs;
      if (liveExpiryMs == null || Math.abs(snapshot.expiryMs - liveExpiryMs) > SAME_EXPIRY_MS) {
        snapshotMarks.push({
          expiryMs: snapshot.expiryMs,
          label: t('snapshotExpiry', { date: fmtDayMonth(snapshot.expiryMs, locale) }),
          nearest: false,
        });
      }
    }
    snapshotLinesRef.current?.setMarks(snapshotMarks, lastSec, resolutionSec);
  }, [
    expiryMarks,
    candles,
    projections,
    profitFrontiers,
    showProjections,
    resolutionSec,
    snapshot,
    locale,
    t,
  ]);

  // Dot at the snapshot's capture point: the spot every path left from.
  useEffect(() => {
    const plugin = anchorMarkersRef.current;
    if (!plugin) return;
    let anchorBar: SpotCandle | undefined;
    if (snapshot && showProjections) {
      for (const c of candles) {
        if (c.timestamp > snapshot.anchorMs) break;
        anchorBar = c;
      }
    }
    plugin.setMarkers(
      anchorBar && snapshot
        ? [
            {
              time: Math.floor(anchorBar.timestamp / 1000) as Time,
              position: 'atPriceMiddle',
              price: snapshot.spot,
              shape: 'circle',
              color: `rgb(${SNAP_RGB})`,
              size: 0.8,
            },
          ]
        : [],
    );
  }, [snapshot, showProjections, candles]);

  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;

    if (!showProjections) {
      for (const series of frontierSeriesRef.current.values()) series.setData([]);
      return;
    }

    const activeKinds = new Set<ProfitFrontier['kind']>();
    for (const frontier of profitFrontiers) {
      const scenario = frontier.kind === 'scenario';
      let series = frontierSeriesRef.current.get(frontier.kind);
      if (!series) {
        series = chart.addSeries(LineSeries, {
          color: scenario ? '#53A7FF' : '#F0B90B',
          lineWidth: 2,
          lineStyle: scenario ? LineStyle.Dashed : LineStyle.Solid,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        frontierSeriesRef.current.set(frontier.kind, series);
      }
      series.setData(
        frontier.points.map((point) => ({
          time: Math.floor(point.timestamp / 1000) as number,
          value: point.price,
        })) as never,
      );
      activeKinds.add(frontier.kind);
    }
    for (const [kind, series] of frontierSeriesRef.current) {
      if (!activeKinds.has(kind)) series.setData([]);
    }
  }, [profitFrontiers, showProjections]);

  if (!available) {
    return (
      <div className={styles.chartV2EmptyState}>
        <div className={styles.chartV2EmptyTitle}>{t('noHistory')}</div>
        <div className={styles.chartV2EmptyDetail}>{t('v1Accurate')}</div>
        <button className={styles.chartV2EmptyBtn} onClick={onSwitchToV1}>
          {t('switchToV1')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.chartV2Frame}>
      <div className={styles.chartV2Inner}>
        <div className={styles.chartV2Wrap} ref={chartRef} />
        {loading && (
          <div className={styles.chartV2Overlay}>
            <Spinner size="lg" />
          </div>
        )}
        {showProjections && projections.some((set) => set.paths.length > 0) && (
          <div className={styles.ghostLegend}>
            {projections.map(
              (set) =>
                set.paths.length > 0 && (
                  <div
                    key={set.id}
                    className={styles.ghostLegendGroup}
                    data-muted={set.id === 'snapshot'}
                  >
                    {snapshot && (
                      <div className={styles.ghostLegendSnap} data-set={set.id}>
                        {set.id === 'snapshot'
                          ? t('snapshotAgo', { ago: snapshot.agoLabel })
                          : t('live')}
                      </div>
                    )}
                    {set.paths.map((p) => (
                      <div key={p.kind} className={styles.ghostLegendRow}>
                        <span className={styles.ghostLegendDot} data-profit={p.isProfit} />
                        <span className={styles.ghostLegendLabel}>{t(`ghost_${p.kind}`)}</span>
                        <span className={styles.ghostLegendPnl} data-profit={p.isProfit}>
                          {fmtUsd(p.pnlAtExpiry)}
                        </span>
                      </div>
                    ))}
                  </div>
                ),
            )}
            {snapshot?.realized && (
              <div className={styles.ghostLegendRealized}>
                {t(snapshot.realized.atExpiry ? 'realizedAtExpiry' : 'realized', {
                  sigma: `${snapshot.realized.sigma >= 0 ? '+' : ''}${snapshot.realized.sigma.toFixed(1)}`,
                  path: t(`ghost_${snapshot.realized.nearest}`),
                })}
              </div>
            )}
          </div>
        )}
        {showProjections && profitFrontiers.length > 0 && (
          <div className={styles.frontierLegend}>
            <strong>{t('profitFrontier')}</strong>
            {profitFrontiers.map((frontier) => (
              <div key={frontier.kind} className={styles.frontierLegendRow}>
                <span data-kind={frontier.kind} />
                <span>
                  {frontier.kind === 'base'
                    ? `IV ${Math.round(frontier.iv * 100)}%`
                    : t('ivShift', {
                        iv: Math.round(frontier.iv * 100),
                        shift: `${frontier.ivShiftPct > 0 ? '+' : ''}${frontier.ivShiftPct}`,
                      })}
                </span>
              </div>
            ))}
            <small>{t('frontierNote')}</small>
          </div>
        )}
      </div>
    </div>
  );
}
