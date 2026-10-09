import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

import { heatColor, type HeatRow } from './oi-heatmap-utils';

interface BitmapCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly bitmapSize: { readonly width: number; readonly height: number };
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

export const MIN_BUBBLE_RADIUS_PX = 4;
export const MAX_BUBBLE_RADIUS_PX = 18;
export const BUBBLE_EDGE_INSET_PX = 10;

// [offset, alphaScale] pairs. Every stop reuses the row's own RGB so the
// interpolation never passes through black on its way to transparent.
export const BUBBLE_FALLOFF_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.4, 0.6],
  [0.75, 0.2],
  [1, 0],
];

export function bubbleRadiusPx(magnitude: number, maxMagnitude: number): number {
  const ratio = maxMagnitude > 0 ? Math.max(0, Math.min(1, magnitude / maxMagnitude)) : 0;
  return MIN_BUBBLE_RADIUS_PX + Math.sqrt(ratio) * (MAX_BUBBLE_RADIUS_PX - MIN_BUBBLE_RADIUS_PX);
}

class HeatBandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly rows: HeatRow[],
    private readonly maxMagnitude: number,
    private readonly priceToY: (price: number) => number | null,
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    if (this.rows.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio } = scope;
      const paneWidth = bitmapSize.width / horizontalPixelRatio;
      const paneHeight = bitmapSize.height / verticalPixelRatio;
      const centerX = paneWidth - BUBBLE_EDGE_INSET_PX - MAX_BUBBLE_RADIUS_PX;
      if (centerX <= 0) return;

      ctx.save();
      ctx.scale(horizontalPixelRatio, verticalPixelRatio);
      for (const row of this.rows) {
        const y = this.priceToY(row.strike);
        if (y === null || !Number.isFinite(y)) continue;
        const radius = bubbleRadiusPx(row.magnitude, this.maxMagnitude);
        if (y + radius < 0 || y - radius > paneHeight) continue;

        const gradient = ctx.createRadialGradient(centerX, y, 0, centerX, y, radius);
        for (const [offset, alphaScale] of BUBBLE_FALLOFF_STOPS) {
          gradient.addColorStop(offset, heatColor(row, this.maxMagnitude, alphaScale));
        }
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(centerX, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }
}

class HeatBandPaneView implements IPrimitivePaneView {
  constructor(
    private readonly rows: HeatRow[],
    private readonly maxMagnitude: number,
    private readonly priceToY: (price: number) => number | null,
  ) {}

  renderer(): IPrimitivePaneRenderer {
    return new HeatBandRenderer(this.rows, this.maxMagnitude, this.priceToY);
  }
}

export class HeatBandPrimitive implements ISeriesPrimitive<Time> {
  private rows: HeatRow[] = [];
  private maxMagnitude = 1;
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

  update(rows: HeatRow[]): void {
    this.rows = rows;
    this.maxMagnitude = rows.length === 0
      ? 1
      : rows.reduce((m, r) => (r.magnitude > m ? r.magnitude : m), 0);
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series) return [];
    const series = this.series;
    const priceToY = (price: number): number | null => series.priceToCoordinate(price);
    return [new HeatBandPaneView(this.rows, this.maxMagnitude, priceToY)];
  }
}
