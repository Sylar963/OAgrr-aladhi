import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  ColorType,
  type AutoscaleInfo,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
} from 'lightweight-charts';

import {
  pnlAtPrice,
  useSpotCandles,
  isSpotCandleCurrency,
  type Leg,
  type PriceZone,
} from '@features/architect';
import { Spinner } from '@components/ui';
import { fmtUsd } from '@lib/format';
import { DeadlinePrimitive } from './deadline-primitive';
import { EASY_OPTION_MIME, decodeDraft, type EasyLegDraft } from './easy-explain';
import { TIMEFRAMES, easyCandleSpec, futureTimes, type EasyTimeframe } from './future-axis';
import styles from './EasyChain.module.css';

interface EasyPayoffChartProps {
  underlying: string;
  expiry: string;
  expiryMs: number;
  legs: Leg[];
  zones: PriceZone[];
  breakevens: number[];
  spot: number | null;
  onDropDraft: (draft: EasyLegDraft) => void;
}

interface HoverReadout {
  price: number;
  pnl: number;
  top: number;
}

type ChartKind = 'candles' | 'line';

const MAX_AUTOSCALE_STRETCH = 0.35;
const UP = '#00E997';
const DOWN = '#CB3855';
const CANDLE_COLORS = {
  upColor: UP,
  downColor: DOWN,
  borderUpColor: UP,
  borderDownColor: DOWN,
  wickUpColor: UP,
  wickDownColor: DOWN,
};
const HIDDEN_CANDLES = {
  upColor: 'transparent',
  downColor: 'transparent',
  borderUpColor: 'transparent',
  borderDownColor: 'transparent',
  wickUpColor: 'transparent',
  wickDownColor: 'transparent',
};

function fmtDeadline(ms: number): string {
  return new Date(ms)
    .toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .toUpperCase();
}

function legLineTitle(leg: Leg): string {
  const qty = leg.quantity > 1 ? `${leg.quantity}× ` : '';
  return `${qty}${leg.direction.toUpperCase()} ${leg.type.toUpperCase()} ${fmtUsd(leg.strike)}`;
}

export default function EasyPayoffChart({
  underlying,
  expiry,
  expiryMs,
  legs,
  zones,
  breakevens,
  spot,
  onDropDraft,
}: EasyPayoffChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const deadlineRef = useRef<DeadlinePrimitive | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const extraPricesRef = useRef<number[]>([]);
  const legsRef = useRef<Leg[]>(legs);
  const lastWindowRef = useRef('');
  const [lastCandleSec, setLastCandleSec] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverReadout | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [timeframe, setTimeframe] = useState<EasyTimeframe>('auto');
  const [kind, setKind] = useState<ChartKind>('candles');

  legsRef.current = legs;

  const specLegs = useMemo<Leg[]>(
    () =>
      legs.length > 0
        ? legs
        : [
            {
              id: 'spec',
              type: 'call',
              direction: 'buy',
              strike: 0,
              expiry,
              quantity: 0,
              entryPrice: 0,
              venue: '',
              delta: null,
              gamma: null,
              theta: null,
              vega: null,
              iv: null,
            },
          ],
    [legs, expiry],
  );
  const spec = easyCandleSpec(timeframe, specLegs);
  const available = isSpotCandleCurrency(underlying);
  const { data: candleData, isLoading, isError } = useSpotCandles(
    underlying,
    spec.resolutionSec,
    spec.buckets,
    spec.refetchIntervalMs,
  );
  const deadlineSec = Math.floor(expiryMs / 1000);
  const noHistory =
    !available || (!isLoading && (isError || candleData?.candles.length === 0));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0A0A0A' },
        textColor: '#6B7280',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: '#131313' }, horzLines: { color: '#131313' } },
      crosshair: {
        horzLine: { color: '#50D2C1', labelBackgroundColor: '#123A35' },
        vertLine: { color: '#2A2A2A', labelBackgroundColor: '#1F1F1F' },
      },
      rightPriceScale: { borderColor: '#1F2937', scaleMargins: { top: 0.08, bottom: 0.1 } },
      timeScale: { borderColor: '#1F2937', timeVisible: true, secondsVisible: false, rightOffset: 2 },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      ...CANDLE_COLORS,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      // Stretch the autoscale so the option strikes and break-evens stay on
      // screen even when they sit outside the recent candle range.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const base = original();
        if (!base?.priceRange) return base;
        let { minValue, maxValue } = base.priceRange;
        const mid = (minValue + maxValue) / 2;
        for (const p of extraPricesRef.current) {
          if (Math.abs(p - mid) / mid > MAX_AUTOSCALE_STRETCH) continue;
          minValue = Math.min(minValue, p);
          maxValue = Math.max(maxValue, p);
        }
        return { ...base, priceRange: { minValue, maxValue } };
      },
    });
    const line = chart.addSeries(LineSeries, {
      color: '#E5E7EB',
      lineWidth: 2,
      visible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const deadline = new DeadlinePrimitive();
    candles.attachPrimitive(deadline);

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || legsRef.current.length === 0) {
        setHover(null);
        return;
      }
      const price = candles.coordinateToPrice(param.point.y);
      if (price == null || Number(price) <= 0) {
        setHover(null);
        return;
      }
      setHover({
        price: Number(price),
        pnl: pnlAtPrice(legsRef.current, Number(price)),
        top: param.point.y,
      });
    });

    chartRef.current = chart;
    candleRef.current = candles;
    lineRef.current = line;
    deadlineRef.current = deadline;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      lineRef.current = null;
      deadlineRef.current = null;
      linesRef.current = [];
      lastWindowRef.current = '';
    };
  }, []);

  useEffect(() => {
    const candles = candleRef.current;
    const line = lineRef.current;
    const chart = chartRef.current;
    const raw = candleData?.candles ?? [];
    if (!candles || !line || !chart || raw.length === 0) return;

    const seen = new Set<number>();
    const bars = raw
      .map((c) => ({
        time: Math.floor(c.timestamp / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
      .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
      .sort((a, b) => a.time - b.time);
    const lastSec = bars.at(-1)!.time;
    const future = futureTimes(lastSec, deadlineSec, spec.resolutionSec).map((time) => ({ time }));

    candles.setData([...bars, ...future] as never);
    line.setData(bars.map((b) => ({ time: b.time, value: b.close })) as never);
    setLastCandleSec(lastSec);

    const windowKey = `${underlying}:${spec.resolutionSec}:${deadlineSec}`;
    if (windowKey !== lastWindowRef.current) {
      // Frame "now → deadline" as roughly the right third of the chart.
      const total = bars.length + future.length;
      const historyShown = Math.min(bars.length, Math.max(40, Math.round(future.length * 2.2)));
      chart.timeScale().setVisibleLogicalRange({
        from: bars.length - historyShown,
        to: total + 1,
      });
      lastWindowRef.current = windowKey;
    }
  }, [candleData, underlying, spec.resolutionSec, deadlineSec]);

  useEffect(() => {
    candleRef.current?.applyOptions(kind === 'candles' ? CANDLE_COLORS : HIDDEN_CANDLES);
    lineRef.current?.applyOptions({ visible: kind === 'line' });
  }, [kind]);

  useEffect(() => {
    deadlineRef.current?.setState({
      zones,
      markers: legs.map((l) => ({
        price: l.strike,
        side: l.type === 'call' ? 'up' : 'down',
        sell: l.direction === 'sell',
      })),
      nowSec: lastCandleSec,
      deadlineSec,
      label: fmtDeadline(expiryMs),
    });
  }, [zones, legs, lastCandleSec, deadlineSec, expiryMs]);

  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    for (const l of linesRef.current) candles.removePriceLine(l);
    linesRef.current = [];

    for (const leg of legs) {
      linesRef.current.push(
        candles.createPriceLine({
          price: leg.strike,
          color: leg.type === 'call' ? UP : DOWN,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: legLineTitle(leg),
        }),
      );
    }
    for (const be of breakevens) {
      linesRef.current.push(
        candles.createPriceLine({
          price: be,
          color: '#F0B90B',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'BE',
        }),
      );
    }

    extraPricesRef.current = [...legs.map((l) => l.strike), ...breakevens];
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
  }, [legs, breakevens]);

  function acceptsDrag(e: DragEvent): boolean {
    return e.dataTransfer.types.includes(EASY_OPTION_MIME);
  }

  return (
    <div
      className={styles.chartFrame}
      data-drag-active={dragActive}
      onDragEnter={(e) => {
        if (acceptsDrag(e)) setDragActive(true);
      }}
      onDragOver={(e) => {
        if (!acceptsDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
      }}
      onDrop={(e) => {
        setDragActive(false);
        const draft = decodeDraft(e.dataTransfer.getData(EASY_OPTION_MIME));
        if (!draft) return;
        e.preventDefault();
        onDropDraft(draft);
      }}
    >
      <div className={styles.chartBody}>
        <div className={styles.chartCanvas} ref={containerRef} />

        <div className={styles.chartToolbar}>
          <div className={styles.toolGroup} role="group" aria-label="Chart type">
            <button
              type="button"
              data-active={kind === 'candles'}
              onClick={() => setKind('candles')}
              title="Candles"
              aria-label="Candles"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M4 2v3M4 11v3M12 1v4M12 10v5" stroke="currentColor" strokeWidth="1.3" />
                <rect x="2.5" y="5" width="3" height="6" fill="currentColor" />
                <rect x="10.5" y="5" width="3" height="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
            <button
              type="button"
              data-active={kind === 'line'}
              onClick={() => setKind('line')}
              title="Line"
              aria-label="Line"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M1 12l4-5 3 3 3-6 4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </div>
          <div className={styles.toolGroup} role="group" aria-label="Timeframe">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.id}
                type="button"
                data-active={timeframe === tf.id}
                onClick={() => setTimeframe(tf.id)}
              >
                {tf.id === 'auto' && timeframe === 'auto' ? `Auto · ${spec.label}` : tf.label}
              </button>
            ))}
          </div>
          {spot != null && <span className={styles.toolSpot}>{underlying} {fmtUsd(spot)}</span>}
        </div>

        {noHistory && (
          <div className={styles.chartNotice}>
            Price history isn’t available for {underlying} right now. Your trade summary below
            still works.
          </div>
        )}
        {available && isLoading && (
          <div className={styles.chartNotice}>
            <Spinner size="lg" />
          </div>
        )}

        {legs.length === 0 && !noHistory && !isLoading && (
          <div className={styles.dropHint}>
            <div className={styles.dropHintTitle}>Drag an option here</div>
            <div className={styles.dropHintText}>
              Pick from <b data-side="up">▲ UP</b> if you think {underlying} will rise, or{' '}
              <b data-side="down">▼ DOWN</b> if you think it will fall. Drop it on the chart to see
              where you would win or lose by the deadline.
            </div>
          </div>
        )}

        {hover && (
          <div
            className={styles.hoverReadout}
            data-profit={hover.pnl > 0}
            style={{ top: Math.max(44, hover.top - 44) }}
          >
            If {underlying} is at <b>{fmtUsd(hover.price)}</b> at the deadline
            <span className={styles.hoverPnl}>
              {hover.pnl > 0 ? '+' : ''}
              {Math.abs(hover.pnl) < 0.5 ? '$0' : fmtUsd(hover.pnl)}
            </span>
          </div>
        )}

        {dragActive && <div className={styles.dropOverlay}>Drop to add to your trade</div>}
      </div>
    </div>
  );
}
