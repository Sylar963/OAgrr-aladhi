import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

import type { BlockBubble } from './oi-bubble-utils';
import { sideRgba } from './oi-heatmap-utils';

interface BitmapCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly bitmapSize: { readonly width: number; readonly height: number };
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

export const MIN_BUBBLE_RADIUS_PX = 2;
export const MAX_BUBBLE_RADIUS_PX = 16;
const SCALE_PERCENTILE = 0.98;
const CORE_ALPHA_FLOOR = 0.35;
const CORE_ALPHA_CEILING = 0.95;

// [offset, alphaScale] pairs. Every stop reuses the bubble's own RGB so the
// interpolation never passes through black on its way to transparent.
export const BUBBLE_FALLOFF_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.5, 0.65],
  [0.8, 0.25],
  [1, 0],
];

// A single outsized block would otherwise shrink every other bubble to the
// minimum radius, so the scale tops out at a high percentile instead of the max.
export function bubbleScaleRef(bubbles: readonly BlockBubble[]): number {
  if (bubbles.length === 0) return 0;
  const sorted = bubbles.map((b) => b.value).sort((a, b) => a - b);
  return sorted[Math.floor(SCALE_PERCENTILE * (sorted.length - 1))]!;
}

function scaleRatio(value: number, scaleRef: number): number {
  return scaleRef > 0 ? Math.max(0, Math.min(1, value / scaleRef)) : 0;
}

export function bubbleRadiusPx(value: number, scaleRef: number): number {
  return MIN_BUBBLE_RADIUS_PX + Math.sqrt(scaleRatio(value, scaleRef)) * (MAX_BUBBLE_RADIUS_PX - MIN_BUBBLE_RADIUS_PX);
}

export function bubbleCoreAlpha(value: number, scaleRef: number): number {
  return CORE_ALPHA_FLOOR + Math.sqrt(scaleRatio(value, scaleRef)) * (CORE_ALPHA_CEILING - CORE_ALPHA_FLOOR);
}

interface BubbleContext {
  bubbles: readonly BlockBubble[];
  scaleRef: number;
  priceToY: (price: number) => number | null;
  timeToX: (timeSec: number) => number | null;
}

class BlockBubbleRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly ctx: BubbleContext) {}

  draw(target: CanvasRenderingTarget2D): void {
    const { bubbles, scaleRef, priceToY, timeToX } = this.ctx;
    if (bubbles.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio } = scope;
      const paneWidth = bitmapSize.width / horizontalPixelRatio;
      const paneHeight = bitmapSize.height / verticalPixelRatio;

      ctx.save();
      ctx.scale(horizontalPixelRatio, verticalPixelRatio);
      for (const bubble of bubbles) {
        const x = timeToX(bubble.timeSec);
        const y = priceToY(bubble.strike);
        if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        const radius = bubbleRadiusPx(bubble.value, scaleRef);
        if (x + radius < 0 || x - radius > paneWidth || y + radius < 0 || y - radius > paneHeight) continue;

        const coreAlpha = bubbleCoreAlpha(bubble.value, scaleRef);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        for (const [offset, alphaScale] of BUBBLE_FALLOFF_STOPS) {
          gradient.addColorStop(offset, sideRgba(bubble.dominant, coreAlpha * alphaScale));
        }
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }
}

class BlockBubblePaneView implements IPrimitivePaneView {
  constructor(private readonly ctx: BubbleContext) {}

  renderer(): IPrimitivePaneRenderer {
    return new BlockBubbleRenderer(this.ctx);
  }
}

export class BlockBubblePrimitive implements ISeriesPrimitive<Time> {
  private bubbles: BlockBubble[] = [];
  private scaleRef = 0;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private chart: SeriesAttachedParameter<Time>['chart'] | null = null;
  private requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series;
    this.chart = param.chart;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
  }

  update(bubbles: BlockBubble[]): void {
    this.bubbles = bubbles;
    this.scaleRef = bubbleScaleRef(bubbles);
    this.requestUpdate?.();
  }

  bubbleAt(timeSec: number, y: number): BlockBubble | null {
    if (!this.series) return null;
    let best: BlockBubble | null = null;
    for (const bubble of this.bubbles) {
      if (bubble.timeSec !== timeSec) continue;
      const by = this.series.priceToCoordinate(bubble.strike);
      if (by === null) continue;
      if (Math.abs(by - y) > bubbleRadiusPx(bubble.value, this.scaleRef)) continue;
      if (!best || bubble.value > best.value) best = bubble;
    }
    return best;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series || !this.chart) return [];
    const series = this.series;
    const timeScale = this.chart.timeScale();
    return [
      new BlockBubblePaneView({
        bubbles: this.bubbles,
        scaleRef: this.scaleRef,
        priceToY: (price) => series.priceToCoordinate(price),
        timeToX: (timeSec) => timeScale.timeToCoordinate(timeSec as Time),
      }),
    ];
  }
}
