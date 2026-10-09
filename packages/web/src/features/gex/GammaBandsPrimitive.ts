// Keltner-style gamma bands. Two parts:
//   • history — recorded call/put walls and flip, SMA-smoothed per candle,
//     drawn as moving lines with the channel filled between them;
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

import type { AlignedWalls } from './gex-wall-history';
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
const CHANNEL_FILL = 'rgba(80, 210, 193, 0.07)';
const PROJECTION_FILL = 'rgba(80, 210, 193, 0.12)';

type WallKey = 'callWall' | 'putWall' | 'gammaFlip';

const LEVELS: ReadonlyArray<{ key: WallKey; color: string; label: string; width: number }> = [
  { key: 'callWall', color: CALL_WALL_COLOR, label: 'CALL WALL', width: 2 },
  { key: 'putWall', color: PUT_WALL_COLOR, label: 'PUT WALL', width: 2 },
  { key: 'gammaFlip', color: FLIP_COLOR, label: 'FLIP', width: 1 },
];

interface BandsContext {
  history: readonly AlignedWalls[];
  live: GammaWalls;
  anchorSec: number | null;
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
      const { history, live, anchorSec, priceToY, timeToX } = this.ctx;

      const toXY = (time: number, price: number | null): XY | null => {
        if (price == null) return null;
        const x = timeToX(time as Time);
        const y = priceToY(price);
        return x === null || y === null ? null : { x: x * hpr, y: y * vpr };
      };

      const gapAfter = gapFlags(history);
      fillChannel(context, history, gapAfter, toXY);
      for (const level of LEVELS) {
        const runs = splitRuns(history.map((h) => toXY(h.time, h[level.key])), gapAfter);
        context.save();
        context.strokeStyle = level.color;
        context.lineWidth = level.width * hpr;
        if (level.key === 'gammaFlip') context.setLineDash([4 * hpr, 3 * hpr]);
        for (const run of runs) strokeLine(context, run);
        context.restore();
      }

      if (anchorSec === null) return;
      const anchorX = timeToX(anchorSec as Time);
      if (anchorX === null) return;
      const x0 = anchorX * hpr;
      const x1 = bitmapSize.width;
      if (x1 <= x0) return;

      if (live.callWall != null && live.putWall != null) {
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
          `${Math.round(price).toLocaleString()} ${level.label}`,
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

// History skips candles inside recording gaps; flag where the spacing exceeds
// the usual candle step so lines break there instead of bridging the gap.
function gapFlags(history: readonly AlignedWalls[]): boolean[] {
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
  history: readonly AlignedWalls[],
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
    const upper = toXY(h.time, h.callWall);
    const lower = toXY(h.time, h.putWall);
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
  private history: AlignedWalls[] = [];
  private live: GammaWalls = { callWall: null, putWall: null, gammaFlip: null };
  // Last real candle time; timeToCoordinate only resolves series data times.
  private anchorSec: number | null = null;
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

  update(history: readonly AlignedWalls[], live: GammaWalls, anchorSec: number | null): void {
    this.history = [...history];
    this.live = live;
    this.anchorSec = anchorSec;
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
        anchorSec: this.anchorSec,
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
