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

export function secondsToBarClose(resolutionSec: number, nowMs: number): number {
  const resMs = resolutionSec * 1000;
  const closeMs = (Math.floor(nowMs / resMs) + 1) * resMs;
  return Math.max(0, Math.floor((closeMs - nowMs) / 1000));
}

export function formatBarCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mmss}` : mmss;
}

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
      text: () => formatBarCountdown(secondsToBarClose(this.resolutionSec, Date.now())),
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
