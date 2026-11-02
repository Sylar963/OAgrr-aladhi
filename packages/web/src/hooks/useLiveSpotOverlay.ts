import {
  type AggregatedSpotCandle,
  isAggregatedSpotUnderlying,
  SpotCandleWsMessageSchema,
} from '@oggregator/protocol';
import {
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type ISeriesPrimitiveAxisView,
  type SeriesAttachedParameter,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type RefObject, useEffect, useRef } from 'react';
import { onConnectionResume } from '@lib/connection-resume';
import { formatCountdown, nextBucketCloseMs } from '@lib/candle-countdown';
import { wsUrl } from '@lib/http';

export interface OverlayCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

const VOLUME_SCALE_ID = 'spot-volume';
const VOLUME_UP = 'rgba(0, 233, 151, 0.28)';
const VOLUME_DOWN = 'rgba(203, 56, 85, 0.28)';
// Sits directly under the series' last-price label on the axis.
const COUNTDOWN_OFFSET_PX = 17;
const COUNTDOWN_BACKGROUND = '#1F2937';
const COUNTDOWN_TEXT = '#E5E7EB';

class CandleCountdownPrimitive implements ISeriesPrimitive<Time> {
  private series: SeriesAttachedParameter<Time>['series'] | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastClose: number | null = null;
  private readonly view: ISeriesPrimitiveAxisView;

  constructor(private readonly resolutionSec: number) {
    this.view = {
      coordinate: () => {
        if (this.lastClose == null || !this.series) return -1;
        const y = this.series.priceToCoordinate(this.lastClose);
        return y == null ? -1 : y + COUNTDOWN_OFFSET_PX;
      },
      text: () => {
        const now = Date.now();
        return formatCountdown(nextBucketCloseMs(this.resolutionSec * 1000, now) - now);
      },
      textColor: () => COUNTDOWN_TEXT,
      backColor: () => COUNTDOWN_BACKGROUND,
      visible: () => this.lastClose != null,
      tickVisible: () => false,
    };
  }

  setLastClose(close: number | null): void {
    this.lastClose = close;
  }

  attached({ series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.series = series;
    this.timer = setInterval(requestUpdate, 1000);
  }

  detached(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.series = null;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return [this.view];
  }
}

/**
 * What every live spot chart adds to its candle series: a volume histogram along the
 * bottom, a countdown to the bar's close on the price axis, and forming-bar updates.
 */
export class LiveSpotOverlay {
  private readonly countdown: CandleCountdownPrimitive;
  private readonly volume: ISeriesApi<'Histogram', Time>;
  private lastSec = 0;

  constructor(
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<'Candlestick', Time>,
    resolutionSec: number,
    // A chart with whitespace after the last bar needs historical updates to fill it in.
    private readonly futureWhitespace: boolean,
  ) {
    this.countdown = new CandleCountdownPrimitive(resolutionSec);
    series.attachPrimitive(this.countdown);
    this.volume = chart.addSeries(HistogramSeries, {
      priceScaleId: VOLUME_SCALE_ID,
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale(VOLUME_SCALE_ID).applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } });
  }

  setHistory(candles: readonly OverlayCandle[]): void {
    const last = candles[candles.length - 1];
    this.lastSec = last ? Math.floor(last.timestamp / 1000) : 0;
    this.countdown.setLastClose(last?.close ?? null);
    this.volume.setData(
      candles.flatMap((candle) =>
        candle.volume == null ? [] : [volumePoint(candle, candle.volume)],
      ),
    );
  }

  applyBar(candle: OverlayCandle): void {
    const time = Math.floor(candle.timestamp / 1000);
    const older = time < this.lastSec;
    try {
      this.series.update(
        {
          time: time as UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        },
        this.futureWhitespace || older,
      );
      if (candle.volume != null) this.volume.update(volumePoint(candle, candle.volume), older);
    } catch {
      // A bar outside the data the chart holds (history still loading); the next poll has it.
      return;
    }
    if (!older) {
      this.lastSec = time;
      this.countdown.setLastClose(candle.close);
    }
  }

  dispose(chartAlive: boolean): void {
    if (!chartAlive) return;
    this.series.detachPrimitive(this.countdown);
    this.chart.removeSeries(this.volume);
  }
}

function volumePoint(candle: OverlayCandle, value: number) {
  return {
    time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
    value,
    color: candle.close >= candle.open ? VOLUME_UP : VOLUME_DOWN,
  };
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, 15_000);
}

interface UseLiveSpotOverlayArgs {
  chartRef: RefObject<IChartApi | null>;
  seriesRef: RefObject<ISeriesApi<'Candlestick', Time> | null>;
  /** Null, or a ticker without aggregated spot, leaves the chart as it is. */
  currency: string | null;
  resolutionSec: number;
  candles: readonly OverlayCandle[] | undefined;
  /** False while `candles` still belong to another timeframe or ticker. */
  ready?: boolean;
  futureWhitespace?: boolean;
  onBar?: (candle: AggregatedSpotCandle) => void;
}

/** Call after the effect that creates the chart: effects run in declaration order. */
export function useLiveSpotOverlay({
  chartRef,
  seriesRef,
  currency,
  resolutionSec,
  candles,
  ready = true,
  futureWhitespace = false,
  onBar,
}: UseLiveSpotOverlayArgs): void {
  const enabled = currency != null && isAggregatedSpotUnderlying(currency);
  const overlayRef = useRef<LiveSpotOverlay | null>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const onBarRef = useRef(onBar);
  onBarRef.current = onBar;

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!enabled || !chart || !series) return;
    const overlay = new LiveSpotOverlay(chart, series, resolutionSec, futureWhitespace);
    overlayRef.current = overlay;
    return () => {
      overlayRef.current = null;
      // The chart's own cleanup runs first on unmount and clears its ref.
      overlay.dispose(chartRef.current === chart);
    };
  }, [enabled, resolutionSec, futureWhitespace, chartRef, seriesRef]);

  useEffect(() => {
    if (ready && candles) overlayRef.current?.setHistory(candles);
  }, [candles, ready, enabled, resolutionSec]);

  useEffect(() => {
    if (!enabled || currency == null) return;
    const url = new URL(wsUrl('/ws/spot-candles'));
    url.searchParams.set('currency', currency);
    url.searchParams.set('resolution', String(resolutionSec));

    let socket: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const close = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.close(1000, 'unmount');
      socket = null;
    };

    const connect = () => {
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (event: MessageEvent) => {
        let json: unknown;
        try {
          json = JSON.parse(event.data as string);
        } catch {
          return;
        }
        const message = SpotCandleWsMessageSchema.safeParse(json);
        if (!message.success || message.data.type !== 'bar' || !readyRef.current) return;
        overlayRef.current?.applyBar(message.data.candle);
        onBarRef.current?.(message.data.candle);
      };
      ws.onclose = () => {
        socket = null;
        reconnectTimer = setTimeout(connect, backoffMs(attempt));
        attempt += 1;
      };
    };

    connect();
    const stopResume = onConnectionResume(() => {
      close();
      connect();
    });
    return () => {
      stopResume();
      close();
    };
  }, [enabled, currency, resolutionSec]);
}
