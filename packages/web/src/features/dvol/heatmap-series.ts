import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from 'lightweight-charts';

import { cellValue, heatColor, type HeatSide } from './heatmap-model';

export interface HeatTrade {
  /** IV in percent. */
  iv: number;
  vega: number;
  side: 'buy' | 'sell';
}

export interface HeatBar extends CustomData<Time> {
  /** `[ivPct, bidVega, askVega]` */
  cells: ReadonlyArray<readonly [number, number, number]>;
  trades: readonly HeatTrade[];
  low: number;
  high: number;
}

export interface HeatSeriesOptions extends CustomSeriesOptions {
  bucketPct: number;
  side: HeatSide;
  scaleMax: number;
  tradeScaleMax: number;
}

type Target = Parameters<ICustomSeriesPaneRenderer['draw']>[0];

const MAX_TRADE_RADIUS = 9;
const MIN_TRADE_RADIUS = 2;

class HeatRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, HeatBar> | null = null;
  private options: HeatSeriesOptions | null = null;

  update(data: PaneRendererCustomData<Time, HeatBar>, options: HeatSeriesOptions): void {
    this.data = data;
    this.options = options;
  }

  draw(target: Target, toY: PriceToCoordinateConverter): void {
    const data = this.data;
    const options = this.options;
    if (data?.visibleRange == null || options == null) return;
    const { from, to } = data.visibleRange;
    const half = (data.barSpacing * data.conflationFactor) / 2;
    const halfBucket = options.bucketPct / 2;

    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      for (let i = from; i < to; i++) {
        const bar = data.bars[i];
        if (bar == null) continue;
        const left = Math.round((bar.x - half) * hr);
        const width = Math.max(1, Math.round((bar.x + half) * hr) - left);
        for (const [iv, bid, ask] of bar.originalData.cells) {
          const color = heatColor(cellValue(bid, ask, options.side) / options.scaleMax);
          if (color == null) continue;
          const top = toY(iv + halfBucket);
          const bottom = toY(iv - halfBucket);
          if (top == null || bottom == null) continue;
          const y = Math.round(top * vr);
          ctx.fillStyle = color;
          ctx.fillRect(left, y, width, Math.max(1, Math.round(bottom * vr) - y));
        }
      }

      for (let i = from; i < to; i++) {
        const bar = data.bars[i];
        if (bar == null) continue;
        for (const trade of bar.originalData.trades) {
          const y = toY(trade.iv);
          if (y == null) continue;
          const r =
            Math.max(
              MIN_TRADE_RADIUS,
              Math.min(MAX_TRADE_RADIUS, Math.sqrt(trade.vega / options.tradeScaleMax) * MAX_TRADE_RADIUS),
            ) * hr;
          ctx.beginPath();
          ctx.arc(bar.x * hr, y * vr, r, 0, Math.PI * 2);
          ctx.fillStyle = trade.side === 'buy' ? 'rgba(46, 204, 113, 0.55)' : 'rgba(231, 76, 60, 0.55)';
          ctx.fill();
          ctx.lineWidth = hr;
          ctx.strokeStyle = trade.side === 'buy' ? '#2ECC71' : '#E74C3C';
          ctx.stroke();
        }
      }
    });
  }
}

/** Bookmap-style heatmap in IV space for lightweight-charts. */
export class HeatSeries implements ICustomSeriesPaneView<Time, HeatBar, HeatSeriesOptions> {
  private readonly heatRenderer = new HeatRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this.heatRenderer;
  }

  update(data: PaneRendererCustomData<Time, HeatBar>, options: HeatSeriesOptions): void {
    this.heatRenderer.update(data, options);
  }

  priceValueBuilder(bar: HeatBar): CustomSeriesPricePlotValues {
    return [bar.low, bar.high, (bar.low + bar.high) / 2];
  }

  isWhitespace(data: HeatBar | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return !('cells' in data);
  }

  defaultOptions(): HeatSeriesOptions {
    return {
      ...customSeriesDefaultOptions,
      bucketPct: 0.25,
      side: 'all',
      scaleMax: 1,
      tradeScaleMax: 1,
    };
  }
}
