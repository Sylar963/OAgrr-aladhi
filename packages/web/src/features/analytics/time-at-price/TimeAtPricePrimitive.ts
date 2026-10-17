import type {
  AutoscaleInfo,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

interface BitmapCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly bitmapSize: { readonly width: number; readonly height: number };
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

export interface HeatLevel {
  price: number;
  bars: number;
}

export interface PriceBand {
  from: number;
  to: number;
}

const HEAT_RGB = '237, 111, 28';
const MAX_ALPHA = 0.75;
const HIGHLIGHT_FILL = 'rgba(232, 236, 235, 0.08)';
const HIGHLIGHT_STROKE = 'rgba(232, 236, 235, 0.55)';

interface HeatContext {
  levels: readonly HeatLevel[];
  binSize: number;
  maxBars: number;
  highlight: PriceBand | null;
  priceToY: (price: number) => number | null;
}

class TimeAtPriceRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly ctx: HeatContext) {}

  draw(target: CanvasRenderingTarget2D): void {
    const { levels, binSize, maxBars, highlight, priceToY } = this.ctx;
    if (levels.length === 0 || !(maxBars > 0)) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio } = scope;
      const width = bitmapSize.width / horizontalPixelRatio;
      const height = bitmapSize.height / verticalPixelRatio;
      ctx.save();
      ctx.scale(horizontalPixelRatio, verticalPixelRatio);
      for (const level of levels) {
        if (level.bars <= 0) continue;
        const yLow = priceToY(level.price);
        const yHigh = priceToY(level.price + binSize);
        if (yLow == null || yHigh == null) continue;
        const top = Math.min(yLow, yHigh);
        const bandHeight = Math.max(1, Math.abs(yLow - yHigh));
        if (top > height || top + bandHeight < 0) continue;
        ctx.fillStyle = `rgba(${HEAT_RGB}, ${((level.bars / maxBars) * MAX_ALPHA).toFixed(3)})`;
        // Overlap by a pixel fraction so adjacent bands don't leave hairline seams.
        ctx.fillRect(0, top - 0.25, width, bandHeight + 0.5);
      }
      if (highlight != null) {
        const y1 = priceToY(highlight.from);
        const y2 = priceToY(highlight.to);
        if (y1 != null && y2 != null) {
          const top = Math.min(y1, y2);
          const bandHeight = Math.abs(y1 - y2);
          ctx.fillStyle = HIGHLIGHT_FILL;
          ctx.fillRect(0, top, width, bandHeight);
          ctx.strokeStyle = HIGHLIGHT_STROKE;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(0.5, top + 0.5, width - 1, Math.max(0, bandHeight - 1));
        }
      }
      ctx.restore();
    });
  }
}

class TimeAtPricePaneView implements IPrimitivePaneView {
  constructor(private readonly ctx: HeatContext) {}

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return new TimeAtPriceRenderer(this.ctx);
  }
}

export class TimeAtPricePrimitive implements ISeriesPrimitive<Time> {
  private levels: HeatLevel[] = [];
  private binSize = 0;
  private maxBars = 0;
  private highlight: PriceBand | null = null;
  private autoscale: AutoscaleInfo | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  setLevels(levels: HeatLevel[], binSize: number): void {
    this.levels = levels;
    this.binSize = binSize;
    this.maxBars = levels.reduce((max, level) => (level.bars > max ? level.bars : max), 0);
    const first = levels[0];
    const last = levels[levels.length - 1];
    this.autoscale =
      first != null && last != null
        ? { priceRange: { minValue: first.price, maxValue: last.price + binSize } }
        : null;
    this.requestUpdate?.();
  }

  setHighlight(highlight: PriceBand | null): void {
    this.highlight = highlight;
    this.requestUpdate?.();
  }

  autoscaleInfo(): AutoscaleInfo | null {
    return this.autoscale;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series) return [];
    const series = this.series;
    return [
      new TimeAtPricePaneView({
        levels: this.levels,
        binSize: this.binSize,
        maxBars: this.maxBars,
        highlight: this.highlight,
        priceToY: (price) => series.priceToCoordinate(price),
      }),
    ];
  }
}
