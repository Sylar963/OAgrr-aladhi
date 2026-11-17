// Gamma bands. Two parts:
//   • history — GEX Keltner channel (EMA basis ± EMA wall distance) plus the
//     EMA'd flip, drawn as moving lines with the channel filled between them;
//   • projection — the live walls drawn only to the right of the last candle,
//     so the current snapshot never pretends to describe past price action.

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
import { type GammaHeatmap, gammaContours, gammaHeatColor } from './gamma-heatmap';
import type { GexKeltnerPoint } from './gex-wall-history';
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
const BASIS_COLOR = 'rgba(154, 160, 166, 0.6)';
const CHANNEL_FILL = 'rgba(80, 210, 193, 0.07)';
const PROJECTION_FILL = 'rgba(80, 210, 193, 0.12)';

type WallKey = 'callWall' | 'putWall' | 'gammaFlip';

export type WallLabels = Readonly<Record<WallKey, string>>;

const LEVELS: ReadonlyArray<{ key: WallKey; color: string; width: number }> = [
  { key: 'callWall', color: CALL_WALL_COLOR, width: 2 },
  { key: 'putWall', color: PUT_WALL_COLOR, width: 2 },
  { key: 'gammaFlip', color: FLIP_COLOR, width: 1 },
];

type HistoryKey = 'upper' | 'lower' | 'basis' | 'gammaFlip';

const HISTORY_LINES: ReadonlyArray<{ key: HistoryKey; color: string; width: number }> = [
  { key: 'upper', color: CALL_WALL_COLOR, width: 2 },
  { key: 'lower', color: PUT_WALL_COLOR, width: 2 },
  { key: 'basis', color: BASIS_COLOR, width: 1 },
  { key: 'gammaFlip', color: FLIP_COLOR, width: 1 },
];

interface BandsContext {
  history: readonly GexKeltnerPoint[];
  live: GammaWalls;
  heatmap: GammaHeatmap | null;
  anchorSec: number | null;
  labels: WallLabels;
  priceToY: (price: number) => number | null;
  timeToX: (time: Time) => number | null;
}

interface XY {
  x: number;
  y: number;
}

class GammaBandsRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly ctx: BandsContext) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const { context, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr } = scope;
      const { history, live, heatmap, anchorSec, labels, priceToY, timeToX } = this.ctx;

      const toXY = (time: number, price: number | null): XY | null => {
        if (price == null) return null;
        const x = timeToX(time as Time);
        const y = priceToY(price);
        return x === null || y === null ? null : { x: x * hpr, y: y * vpr };
      };

      const gapAfter = gapFlags(history);
      fillChannel(context, history, gapAfter, toXY);
      for (const line of HISTORY_LINES) {
        const runs = splitRuns(
          history.map((h) => toXY(h.time, h[line.key])),
          gapAfter,
        );
        context.save();
        context.strokeStyle = line.color;
        context.lineWidth = line.width * hpr;
        if (line.key === 'gammaFlip') context.setLineDash([4 * hpr, 3 * hpr]);
        for (const run of runs) strokeLine(context, run);
        context.restore();
      }

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
  ctx.restore();
}

// History skips candles inside recording gaps; flag where the spacing exceeds
// the usual candle step so lines break there instead of bridging the gap.
function gapFlags(history: readonly GexKeltnerPoint[]): boolean[] {
  let step = Infinity;
  for (let i = 1; i < history.length; i++) {
    const d = history[i]!.time - history[i - 1]!.time;
    if (d > 0 && d < step) step = d;
  }
  return history.map((h, i) => i + 1 < history.length && history[i + 1]!.time - h.time > step);
}

function splitRuns(points: ReadonlyArray<XY | null>, gapAfter: readonly boolean[]): XY[][] {
  const runs: XY[][] = [];
  let run: XY[] = [];
  points.forEach((p, i) => {
    if (p) run.push(p);
    if ((!p || gapAfter[i]) && run.length > 0) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  return runs;
}

function strokeLine(ctx: CanvasRenderingContext2D, run: readonly XY[]): void {
  ctx.beginPath();
  ctx.moveTo(run[0]!.x, run[0]!.y);
  for (let i = 1; i < run.length; i++) ctx.lineTo(run[i]!.x, run[i]!.y);
  ctx.stroke();
}

function fillChannel(
  ctx: CanvasRenderingContext2D,
  history: readonly GexKeltnerPoint[],
  gapAfter: readonly boolean[],
  toXY: (time: number, price: number | null) => XY | null,
): void {
  ctx.fillStyle = CHANNEL_FILL;
  let run: Array<{ upper: XY; lower: XY }> = [];
  const flush = () => {
    if (run.length > 1) {
      ctx.beginPath();
      ctx.moveTo(run[0]!.upper.x, run[0]!.upper.y);
      for (let i = 1; i < run.length; i++) ctx.lineTo(run[i]!.upper.x, run[i]!.upper.y);
      for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(run[i]!.lower.x, run[i]!.lower.y);
      ctx.closePath();
      ctx.fill();
    }
    run = [];
  };
  history.forEach((h, i) => {
    const upper = toXY(h.time, h.upper);
    const lower = toXY(h.time, h.lower);
    if (upper && lower) run.push({ upper, lower });
    else flush();
    if (gapAfter[i]) flush();
  });
  flush();
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
  private history: GexKeltnerPoint[] = [];
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

  update(history: readonly GexKeltnerPoint[], live: GammaWalls, anchorSec: number | null): void {
    this.history = [...history];
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
        history: this.history,
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
