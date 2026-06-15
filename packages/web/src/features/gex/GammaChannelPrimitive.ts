// Filled gamma-band channel — a translucent rectangle between the put wall
// (support) and call wall (resistance). Price-only (full chart width), so it
// needs no time mapping — sidestepping the timeToCoordinate gotcha entirely.

import type {
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
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

// Faint neutral teal so the channel reads as the "expected range" without
// fighting the colored wall lines drawn on top.
const CHANNEL_FILL = 'rgba(80, 210, 193, 0.06)';

class GammaChannelRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly upper: number | null,
    private readonly lower: number | null,
    private readonly priceToY: (price: number) => number | null,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    if (this.upper === null || this.lower === null) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, verticalPixelRatio } = scope;
      const yA = this.priceToY(this.upper as number);
      const yB = this.priceToY(this.lower as number);
      if (yA === null || yB === null) return;
      const top = Math.min(yA, yB) * verticalPixelRatio;
      const bottom = Math.max(yA, yB) * verticalPixelRatio;
      ctx.fillStyle = CHANNEL_FILL;
      ctx.fillRect(0, top, bitmapSize.width, bottom - top);
    });
  }
}

class GammaChannelPaneView implements IPrimitivePaneView {
  constructor(
    private readonly upper: number | null,
    private readonly lower: number | null,
    private readonly priceToY: (price: number) => number | null,
  ) {}

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return new GammaChannelRenderer(this.upper, this.lower, this.priceToY);
  }
}

export class GammaChannelPrimitive implements ISeriesPrimitive<Time> {
  private upper: number | null = null;
  private lower: number | null = null;
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

  update(upper: number | null, lower: number | null): void {
    this.upper = upper;
    this.lower = lower;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series) return [];
    const series = this.series;
    return [new GammaChannelPaneView(this.upper, this.lower, (p) => series.priceToCoordinate(p))];
  }
}
