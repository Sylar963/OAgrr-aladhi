import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineStyle,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
} from 'lightweight-charts';

import { Spinner } from '@components/ui';
import type { Leg } from './payoff';
import { pnlAtPrice } from './payoff';
import { dteDays } from '@lib/format';
import type { SpotCandle } from './queries';
import styles from './Architect.module.css';

interface PayoffChartV2Props {
  candles: SpotCandle[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  loading: boolean;
  available: boolean;
  onSwitchToV1: () => void;
}

interface Zone {
  low: number;
  high: number;
  profit: boolean;
}

interface ZoneRect {
  topPct: number;
  heightPct: number;
  profit: boolean;
}

export interface CandleSpec {
  resolutionSec: number;
  buckets: number;
}

/**
 * Pick a candle window that scales with the strategy's nearest-leg DTE so
 * the price-history view always reflects the chosen tenor. Bucket count
 * varies with DTE within each resolution tier — this guarantees that any
 * tenor change produces a new query key, so TanStack Query refetches.
 */
export function pickCandleSpec(legs: Leg[]): CandleSpec {
  if (legs.length === 0) return { resolutionSec: 3600, buckets: 24 };
  const minDte = Math.max(0, Math.min(...legs.map((l) => dteDays(l.expiry))));

  if (minDte < 1) {
    return { resolutionSec: 300, buckets: 48 };
  }
  if (minDte < 3) {
    const buckets = Math.min(96, Math.max(24, Math.round(minDte * 48)));
    return { resolutionSec: 1800, buckets };
  }
  if (minDte < 14) {
    const buckets = Math.min(168, Math.max(24, Math.round(minDte * 24)));
    return { resolutionSec: 3600, buckets };
  }
  if (minDte < 60) {
    const buckets = Math.min(180, Math.max(42, Math.round(minDte * 6)));
    return { resolutionSec: 14400, buckets };
  }
  return { resolutionSec: 86400, buckets: Math.min(180, Math.max(60, minDte)) };
}

function buildZones(legs: Leg[], breakevens: number[], spotPrice: number): Zone[] {
  if (legs.length === 0) return [];

  if (breakevens.length === 0) {
    const sign = pnlAtPrice(legs, spotPrice) >= 0;
    return [{ low: -Infinity, high: Infinity, profit: sign }];
  }

  const sorted = [...breakevens].sort((a, b) => a - b);
  const zones: Zone[] = [];
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
  loading,
  available,
  onSwitchToV1,
}: PayoffChartV2Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const [zoneRects, setZoneRects] = useState<ZoneRect[]>([]);

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

    chartApiRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartApiRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // Push candle data.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;

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
    chartApiRef.current?.timeScale().fitContent();
  }, [candles]);

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
  }, [breakevens, spotPrice]);

  // Recompute zone DOM overlay rectangles.
  useEffect(() => {
    const overlay = overlayRef.current;
    const series = seriesRef.current;
    if (!overlay || !series) return;

    function recompute() {
      if (!overlay || !series) return;
      const height = overlay.clientHeight;
      if (height === 0) {
        setZoneRects([]);
        return;
      }

      // Resolve the visible price range so we can clamp out-of-range
      // boundaries to the chart edges. priceToCoordinate returns null when a
      // price sits outside the visible scale; without clamping, a butterfly
      // with break-evens tighter than the candle range would have both BEs
      // map to null and the entire middle zone would be dropped.
      const priceTop = series.coordinateToPrice(0);
      const priceBottom = series.coordinateToPrice(height);
      if (priceTop == null || priceBottom == null) {
        setZoneRects([]);
        return;
      }
      const visibleHigh = Math.max(Number(priceTop), Number(priceBottom));
      const visibleLow = Math.min(Number(priceTop), Number(priceBottom));

      function priceToY(price: number): number {
        if (price >= visibleHigh) return 0;
        if (price <= visibleLow) return height;
        const y = series!.priceToCoordinate(price);
        return y == null ? height : Math.max(0, Math.min(height, Number(y)));
      }

      const rects: ZoneRect[] = [];
      for (const zone of zones) {
        const top = Number.isFinite(zone.high) ? priceToY(zone.high as number) : 0;
        const bottom = Number.isFinite(zone.low) ? priceToY(zone.low as number) : height;
        if (bottom <= top) continue;
        rects.push({
          topPct: (top / height) * 100,
          heightPct: ((bottom - top) / height) * 100,
          profit: zone.profit,
        });
      }
      setZoneRects(rects);
    }

    recompute();

    const ro = new ResizeObserver(recompute);
    ro.observe(overlay);

    const chart = chartApiRef.current;
    const sub = () => recompute();
    chart?.timeScale().subscribeVisibleLogicalRangeChange(sub);

    // Schedule a couple of recomputes after data settles since priceScale
    // auto-fits asynchronously after setData.
    const t1 = setTimeout(recompute, 50);
    const t2 = setTimeout(recompute, 250);

    return () => {
      ro.disconnect();
      chart?.timeScale().unsubscribeVisibleLogicalRangeChange(sub);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [zones, candles]);

  if (!available) {
    return (
      <div className={styles.chartV2EmptyState}>
        <div className={styles.chartV2EmptyTitle}>V2 candles cover BTC and ETH only</div>
        <div className={styles.chartV2EmptyDetail}>
          SOL spot history isn’t available on Deribit. The V1 expiry view stays accurate.
        </div>
        <button className={styles.chartV2EmptyBtn} onClick={onSwitchToV1}>
          Switch back to V1
        </button>
      </div>
    );
  }

  return (
    <div className={styles.chartV2Frame}>
      <div className={styles.chartV2Inner}>
        <div className={styles.chartV2Wrap} ref={chartRef} />
        <div className={styles.chartV2ZoneOverlay} ref={overlayRef}>
          {zoneRects.map((rect, i) => (
            <div
              key={i}
              className={styles.chartV2Zone}
              data-profit={rect.profit ? 'true' : 'false'}
              style={{ top: `${rect.topPct}%`, height: `${rect.heightPct}%` }}
            />
          ))}
        </div>
        {loading && (
          <div className={styles.chartV2Overlay}>
            <Spinner size="lg" />
          </div>
        )}
      </div>
    </div>
  );
}
