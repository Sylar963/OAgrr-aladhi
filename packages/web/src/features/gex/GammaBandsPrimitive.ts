// Live gamma stays right of the last candle so the current snapshot never
// pretends to describe past price action.

import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import {
  type GammaHeatmap,
  gammaContours,
  gammaHeatColor,
  visibleGammaProfile,
} from './gamma-heatmap';
import type { GammaWalls } from './gex-wall-utils';

interface BitmapCoordinatesRenderingScope {
  readonly context: CanvasRenderingContext2D;
  readonly bitmapSize: { readonly width: number; readonly height: number };
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace<T>(f: (scope: BitmapCoordinatesRenderingScope) => T): T;
}

export const CALL_WALL_COLOR = '#00E997';
export const PUT_WALL_COLOR = '#CB3855';
export const FLIP_COLOR = '#F0B90B';
const PROJECTION_FILL = 'rgba(80, 210, 193, 0.12)';

type WallKey = 'callWall' | 'putWall' | 'gammaFlip';

export type WallLabels = Readonly<Record<WallKey, string>>;

const LEVELS: ReadonlyArray<{ key: WallKey; color: string; width: number }> = [
  { key: 'callWall', color: CALL_WALL_COLOR, width: 2 },
  { key: 'putWall', color: PUT_WALL_COLOR, width: 2 },
  { key: 'gammaFlip', color: FLIP_COLOR, width: 1 },
];

interface BandsContext {
  live: GammaWalls;
  heatmap: GammaHeatmap | null;
  anchorSec: number | null;
  labels: WallLabels;
  priceToY: (price: number) => number | null;
  timeToX: (time: Time) => number | null;
}

class GammaBandsRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly ctx: BandsContext) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr } = scope;
      const { live, heatmap, anchorSec, labels, priceToY, timeToX } = this.ctx;

      if (anchorSec === null) return;
      const anchorX = timeToX(anchorSec as Time);
      if (anchorX === null) return;
      const x0 = Math.max(0, anchorX * hpr);
      const x1 = bitmapSize.width;
      if (x1 <= x0) return;

      if (heatmap) {
        drawHeatmap(context, heatmap, x0, x1, bitmapSize.height, hpr, vpr, priceToY);
      } else if (live.callWall != null && live.putWall != null) {
        const yA = priceToY(live.callWall);
        const yB = priceToY(live.putWall);
        if (yA !== null && yB !== null) {
          context.fillStyle = PROJECTION_FILL;
          const top = Math.min(yA, yB) * vpr;
          context.fillRect(x0, top, x1 - x0, Math.max(yA, yB) * vpr - top);
        }
      }

      context.save();
      context.font = `${10 * vpr}px 'IBM Plex Mono', monospace`;
      context.textAlign = 'right';
      for (const level of LEVELS) {
        const price = live[level.key];
        if (price == null) continue;
        const y = priceToY(price);
        if (y === null) continue;
        const yb = y * vpr;
        context.strokeStyle = level.color;
        context.lineWidth = level.width * hpr;
        context.setLineDash([6 * hpr, 4 * hpr]);
        context.beginPath();
        context.moveTo(x0, yb);
        context.lineTo(x1, yb);
        context.stroke();
        context.fillStyle = level.color;
        context.fillText(
          `${Math.round(price).toLocaleString('en-US')} ${labels[level.key]}`,
          x1 - 6 * hpr,
          yb - 4 * vpr,
        );
      }
      context.restore();

      context.save();
      context.strokeStyle = 'rgba(154, 160, 166, 0.35)';
      context.lineWidth = hpr;
      context.setLineDash([2 * hpr, 3 * hpr]);
      context.beginPath();
      context.moveTo(x0, 0);
      context.lineTo(x0, bitmapSize.height);
      context.stroke();
      context.restore();
    });
  }
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  heatmap: GammaHeatmap,
  x0: number,
  x1: number,
  height: number,
  hpr: number,
  vpr: number,
  priceToY: (price: number) => number | null,
): void {
  const { points, maxMagnitude, opacity } = heatmap;
  if (points.length < 2 || maxMagnitude === 0 || opacity === 0) return;
  const bottom = priceToY(points[0]!.price);
  const top = priceToY(points[points.length - 1]!.price);
  if (bottom === null || top === null || bottom === top) return;
  const y0 = bottom * vpr;
  const y1 = top * vpr;
  if (Math.min(y0, y1) > height || Math.max(y0, y1) < 0) return;
  const gradient = ctx.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const y = priceToY(point.price);
    if (y === null) continue;
    const previous = points[i - 1];
    if (previous && previous.gexUsdMillions * point.gexUsdMillions < 0) {
      const weight =
        Math.abs(previous.gexUsdMillions) /
        (Math.abs(previous.gexUsdMillions) + Math.abs(point.gexUsdMillions));
      const zeroY = priceToY(previous.price + weight * (point.price - previous.price));
      if (zeroY !== null)
        gradient.addColorStop(
          Math.max(0, Math.min(1, (zeroY * vpr - y0) / (y1 - y0))),
          'rgba(0, 0, 0, 0)',
        );
    }
    gradient.addColorStop(
      Math.max(0, Math.min(1, (y * vpr - y0) / (y1 - y0))),
      gammaHeatColor(point.gexUsdMillions, maxMagnitude, opacity),
    );
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, x1 - x0, height);
  ctx.clip();
  ctx.fillStyle = gradient;
  ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));

  for (const fraction of [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75]) {
    ctx.strokeStyle = fraction === 0 ? 'rgba(230, 237, 243, 0.7)' : 'rgba(230, 237, 243, 0.16)';
    ctx.lineWidth = hpr;
    ctx.setLineDash(fraction === 0 ? [3 * hpr, 4 * hpr] : []);
    for (const price of gammaContours(points, maxMagnitude * fraction)) {
      const y = priceToY(price);
      if (y === null || y < 0 || y * vpr > height) continue;
      ctx.beginPath();
      ctx.moveTo(x0, y * vpr);
      ctx.lineTo(x1, y * vpr);
      ctx.stroke();
    }
  }
  if (heatmap.profileOutline !== false) {
    drawProfileOutline(ctx, heatmap, x0, x1, height, hpr, vpr, priceToY);
  }
  ctx.restore();
}

function drawProfileOutline(
  ctx: CanvasRenderingContext2D,
  heatmap: GammaHeatmap,
  x0: number,
  x1: number,
  height: number,
  hpr: number,
  vpr: number,
  priceToY: (price: number) => number | null,
): void {
  const profile = visibleGammaProfile(
    heatmap.points,
    (price) => {
      const y = priceToY(price);
      return y === null ? null : y * vpr;
    },
    height,
  );
  const maximum = Math.max(...profile.map((point) => Math.abs(point.gexUsdMillions)), 0);
  if (profile.length < 2 || maximum === 0) return;
  const baseline = x1 - Math.min(12 * hpr, (x1 - x0) * 0.08);
  const width = (baseline - x0) * 0.84;
  const toX = (value: number) => baseline - (width * Math.abs(value)) / maximum;

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(baseline, profile[0]!.y);
  ctx.lineTo(baseline, profile[profile.length - 1]!.y);
  ctx.strokeStyle = 'rgba(230, 237, 243, 0.25)';
  ctx.lineWidth = hpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX(profile[0]!.gexUsdMillions), profile[0]!.y);
  for (let i = 1; i < profile.length; i++)
    ctx.lineTo(toX(profile[i]!.gexUsdMillions), profile[i]!.y);
  ctx.strokeStyle = 'rgba(3, 9, 13, 0.9)';
  ctx.lineWidth = 5 * hpr;
  ctx.stroke();
  ctx.setLineDash([5 * hpr, 4 * hpr]);
  ctx.strokeStyle = 'rgba(240, 246, 250, 0.95)';
  ctx.lineWidth = 1.5 * hpr;
  ctx.stroke();
  ctx.restore();
}

class GammaBandsPaneView implements IPrimitivePaneView {
  constructor(private readonly ctx: BandsContext) {}

  zOrder(): 'bottom' | 'normal' | 'top' {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return new GammaBandsRenderer(this.ctx);
  }
}

class WallAxisView implements ISeriesPrimitiveAxisView {
  constructor(
    private readonly series: ISeriesApi<SeriesType, Time>,
    private readonly price: number,
    private readonly color: string,
  ) {}

  coordinate(): number {
    return this.series.priceToCoordinate(this.price) ?? -1;
  }

  text(): string {
    return this.price.toFixed(2);
  }

  textColor(): string {
    return '#0B0B0B';
  }

  backColor(): string {
    return this.color;
  }

  visible(): boolean {
    return this.series.priceToCoordinate(this.price) !== null;
  }
}

export class GammaBandsPrimitive implements ISeriesPrimitive<Time> {
  private live: GammaWalls = { callWall: null, putWall: null, gammaFlip: null };
  private heatmap: GammaHeatmap | null = null;
  // Last real candle time; timeToCoordinate only resolves series data times.
  private anchorSec: number | null = null;
  private labels: WallLabels = {
    callWall: 'POSITIVE Γ ABOVE',
    putWall: 'NEGATIVE Γ BELOW',
    gammaFlip: 'FLIP',
  };
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

  update(live: GammaWalls, anchorSec: number | null): void {
    this.live = live;
    this.anchorSec = anchorSec;
    this.requestUpdate?.();
  }

  setLabels(labels: WallLabels): void {
    this.labels = labels;
    this.requestUpdate?.();
  }

  setHeatmap(heatmap: GammaHeatmap | null): void {
    this.heatmap = heatmap;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    if (!this.series || !this.chart) return [];
    const series = this.series;
    const chart = this.chart;
    return [
      new GammaBandsPaneView({
        live: this.live,
        heatmap: this.heatmap,
        anchorSec: this.anchorSec,
        labels: this.labels,
        priceToY: (p) => series.priceToCoordinate(p),
        timeToX: (t) => chart.timeScale().timeToCoordinate(t),
      }),
    ];
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    if (!this.series) return [];
    const series = this.series;
    const views: ISeriesPrimitiveAxisView[] = [];
    for (const level of LEVELS) {
      const price = this.live[level.key];
      if (price == null) continue;
      views.push(new WallAxisView(series, price, level.color));
    }
    return views;
  }
}
