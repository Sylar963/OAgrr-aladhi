import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  Logical,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

import type { ExpiryMark } from './expiry-timeline';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

interface PixelMark {
  x: number;
  label: string;
  nearest: boolean;
}

export interface VerticalLinePalette {
  strong: string;
  muted: string;
  strongBg: string;
  mutedBg: string;
  /** Label row offset in CSS px, so two primitives' labels don't collide. */
  labelTop: number;
}

const EXPIRY_PALETTE: VerticalLinePalette = {
  strong: '#F0B90B',
  muted: 'rgba(240, 185, 11, 0.45)',
  strongBg: 'rgba(58, 44, 6, 0.92)',
  mutedBg: 'rgba(30, 26, 14, 0.85)',
  labelTop: 6,
};

class ExpiryLinesRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly marks: readonly PixelMark[],
    private readonly palette: VerticalLinePalette,
  ) {}

  draw(target: DrawTarget): void {
    if (this.marks.length === 0) return;
    target.useBitmapCoordinateSpace(
      ({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
        ctx.save();
        ctx.font = `${Math.round(10 * vpr)}px 'IBM Plex Mono', monospace`;
        ctx.textBaseline = 'top';
        for (const m of this.marks) {
          const x = Math.round(m.x * hpr);
          if (x < 0 || x > bitmapSize.width) continue;
          const color = m.nearest ? this.palette.strong : this.palette.muted;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, Math.round(hpr));
          ctx.setLineDash([Math.round(6 * hpr), Math.round(4 * hpr)]);
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, bitmapSize.height);
          ctx.stroke();

          const padX = Math.round(4 * hpr);
          const padY = Math.round(3 * vpr);
          const textW = ctx.measureText(m.label).width;
          const boxW = textW + padX * 2;
          const boxH = Math.round(10 * vpr) + padY * 2;
          // Flip the label to the left of the line when it would overflow the pane.
          const boxX = x + boxW + 2 * hpr > bitmapSize.width ? x - boxW - 2 * hpr : x + 2 * hpr;
          const boxY = Math.round(this.palette.labelTop * vpr);
          ctx.setLineDash([]);
          ctx.fillStyle = m.nearest ? this.palette.strongBg : this.palette.mutedBg;
          ctx.fillRect(boxX, boxY, boxW, boxH);
          ctx.fillStyle = color;
          ctx.fillText(m.label, boxX + padX, boxY + padY);
        }
        ctx.restore();
      },
    );
  }
}

class ExpiryLinesPaneView implements IPrimitivePaneView {
  private pixels: PixelMark[] = [];

  constructor(private readonly palette: VerticalLinePalette) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'top';
  }

  update(pixels: PixelMark[]): void {
    this.pixels = pixels;
  }

  renderer(): IPrimitivePaneRenderer {
    return new ExpiryLinesRenderer(this.pixels, this.palette);
  }
}

export class ExpiryLinesPrimitive implements ISeriesPrimitive<Time> {
  private marks: readonly ExpiryMark[] = [];
  private lastTimeSec: number | null = null;
  private resolutionSec = 3600;
  private attachedParam: SeriesAttachedParameter<Time, SeriesType> | null = null;
  private readonly paneView: ExpiryLinesPaneView;
  private readonly cachedPaneViews: readonly IPrimitivePaneView[];

  constructor(palette: VerticalLinePalette = EXPIRY_PALETTE) {
    this.paneView = new ExpiryLinesPaneView(palette);
    this.cachedPaneViews = [this.paneView];
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.attachedParam = param;
    this.refresh();
  }

  detached(): void {
    this.attachedParam = null;
  }

  /** `lastTimeSec` is the latest time point across every series on the chart. */
  setMarks(marks: readonly ExpiryMark[], lastTimeSec: number | null, resolutionSec: number): void {
    this.marks = marks;
    this.lastTimeSec = lastTimeSec;
    this.resolutionSec = resolutionSec;
    this.refresh();
    this.attachedParam?.requestUpdate();
  }

  updateAllViews(): void {
    this.refresh();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.cachedPaneViews;
  }

  private refresh(): void {
    if (!this.attachedParam) return;
    const { chart } = this.attachedParam;
    const pixels: PixelMark[] = [];
    for (const m of this.marks) {
      const x = this.timeToX(chart, Math.floor(m.expiryMs / 1000));
      if (x != null) pixels.push({ x, label: m.label, nearest: m.nearest });
    }
    this.paneView.update(pixels);
  }

  // Expiries usually fall past the last projected bar, where the time scale has
  // no point to resolve; extrapolate from the last index at one bar per resolution.
  private timeToX(chart: IChartApi, timeSec: number): number | null {
    const timeScale = chart.timeScale();
    if (this.lastTimeSec == null) return null;
    const lastIndex = timeScale.timeToIndex(this.lastTimeSec as Time, true);
    if (lastIndex == null) return null;
    let logical: number;
    if (timeSec > this.lastTimeSec) {
      logical = lastIndex + (timeSec - this.lastTimeSec) / this.resolutionSec;
    } else {
      const idx = timeScale.timeToIndex(timeSec as Time, true);
      if (idx == null) return null;
      logical = idx;
    }
    const x = timeScale.logicalToCoordinate(logical as Logical);
    return x == null ? null : Number(x);
  }
}
