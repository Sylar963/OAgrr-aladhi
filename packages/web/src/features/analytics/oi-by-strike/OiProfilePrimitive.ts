import type {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  ISeriesApi,
  SeriesType,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

import { confidenceFactor, sideRgba, type HeatRow, type HeatSide } from './oi-heatmap-utils';

interface BitmapCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly bitmapSize: { readonly width: number; readonly height: number };
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

export const PROFILE_MAX_WIDTH_FRACTION = 0.2;
export const PROFILE_MAX_WIDTH_PX = 240;
export const PROFILE_MIN_BAR_PX = 2;
export const PROFILE_MAX_BAR_PX = 14;
export const PROFILE_BAR_FILL = 0.8;
export const PROFILE_ALPHA = 0.6;

export type ProfileColorBy = 'side' | 'gamma';

export interface ProfileOptions {
  side: HeatSide;
  colorBy: ProfileColorBy;
  rightInsetPx: number;
}

const DEFAULT_OPTIONS: ProfileOptions = { side: 'both', colorBy: 'side', rightInsetPx: 0 };

interface ProfileContext {
  rows: readonly HeatRow[];
  maxMagnitude: number;
  options: ProfileOptions;
  priceToY: (price: number) => number | null;
}

interface Segment {
  length: number;
  color: string;
}

function segmentsFor(row: HeatRow, ctx: ProfileContext, maxLength: number): Segment[] {
  const scale = ctx.maxMagnitude > 0 ? maxLength / ctx.maxMagnitude : 0;
  if (ctx.options.colorBy === 'gamma') {
    return [{
      length: row.magnitude * scale,
      color: sideRgba(row.dominant, PROFILE_ALPHA * confidenceFactor(row.confidence)),
    }];
  }
  const call = ctx.options.side === 'puts' ? 0 : row.callOi;
  const put = ctx.options.side === 'calls' ? 0 : row.putOi;
  return [
    { length: call * scale, color: sideRgba('call', PROFILE_ALPHA) },
    { length: put * scale, color: sideRgba('put', PROFILE_ALPHA) },
  ];
}

class OiProfileRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly ctx: ProfileContext) {}

  draw(target: CanvasRenderingTarget2D): void {
    const { rows, options, priceToY } = this.ctx;
    if (rows.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio } = scope;
      const paneWidth = bitmapSize.width / horizontalPixelRatio;
      const paneHeight = bitmapSize.height / verticalPixelRatio;
      const anchorX = paneWidth - options.rightInsetPx;
      const maxLength = Math.min(paneWidth * PROFILE_MAX_WIDTH_FRACTION, PROFILE_MAX_WIDTH_PX, anchorX);
      if (maxLength <= 0) return;

      const placed: { row: HeatRow; y: number }[] = [];
      for (const row of rows) {
        const y = priceToY(row.strike);
        if (y !== null && Number.isFinite(y)) placed.push({ row, y });
      }
      placed.sort((a, b) => a.y - b.y);

      ctx.save();
      ctx.scale(horizontalPixelRatio, verticalPixelRatio);
      for (let i = 0; i < placed.length; i++) {
        const { row, y } = placed[i]!;
        const gapAbove = i > 0 ? y - placed[i - 1]!.y : Infinity;
        const gapBelow = i < placed.length - 1 ? placed[i + 1]!.y - y : Infinity;
        const nearest = Math.min(gapAbove, gapBelow);
        const thickness = Math.max(
          PROFILE_MIN_BAR_PX,
          Math.min(PROFILE_MAX_BAR_PX, Number.isFinite(nearest) ? nearest * PROFILE_BAR_FILL : PROFILE_MAX_BAR_PX),
        );
        const top = y - thickness / 2;
        if (top + thickness < 0 || top > paneHeight) continue;

        let right = anchorX;
        for (const segment of segmentsFor(row, this.ctx, maxLength)) {
          if (!(segment.length > 0)) continue;
          const length = Math.max(1, segment.length);
          ctx.fillStyle = segment.color;
          ctx.fillRect(right - length, top, length, thickness);
          right -= length;
        }
      }
      ctx.restore();
    });
  }
}

class OiProfilePaneView implements IPrimitivePaneView {
  constructor(private readonly ctx: ProfileContext) {}

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return new OiProfileRenderer(this.ctx);
  }
}

export class OiProfilePrimitive implements ISeriesPrimitive<Time> {
  private rows: HeatRow[] = [];
  private maxMagnitude = 1;
  private options: ProfileOptions = DEFAULT_OPTIONS;
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

  update(rows: HeatRow[], options: ProfileOptions = DEFAULT_OPTIONS): void {
    this.rows = rows;
    this.options = options;
    this.maxMagnitude = rows.reduce((m, r) => (r.magnitude > m ? r.magnitude : m), 0);
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series) return [];
    const series = this.series;
    return [
      new OiProfilePaneView({
        rows: this.rows,
        maxMagnitude: this.maxMagnitude,
        options: this.options,
        priceToY: (price) => series.priceToCoordinate(price),
      }),
    ];
  }
}
