import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

import type { PriceZone } from '@features/architect';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface DeadlineMarker {
  price: number;
  side: 'up' | 'down';
  sell: boolean;
}

interface PixelZone {
  top: number;
  bottom: number;
  profit: boolean;
  /** Edge that touches a break-even; the gradient fades toward it. */
  innerEdge: 'top' | 'bottom' | null;
}

interface Geometry {
  zones: PixelZone[];
  nowX: number | null;
  deadlineX: number | null;
  label: string;
  profitLabel: string;
  lossLabel: string;
  markers: { y: number; side: 'up' | 'down'; sell: boolean }[];
}

const PROFIT = '0, 233, 151';
const LOSS = '203, 56, 85';
const BAR_W = 6;

class DeadlineRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly geo: Geometry) {}

  drawBackground(target: DrawTarget): void {
    const { zones, nowX, deadlineX } = this.geo;
    if (zones.length === 0) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const futureLeft = nowX ?? mediaSize.width;
      const futureRight = deadlineX ?? mediaSize.width;
      for (const z of zones) {
        const h = z.bottom - z.top;
        if (h <= 0) continue;
        const rgb = z.profit ? PROFIT : LOSS;
        const strong = z.profit ? 0.26 : 0.14;
        const weak = z.profit ? 0.04 : 0.02;
        const grad = ctx.createLinearGradient(0, z.top, 0, z.bottom);
        const [startA, endA] =
          z.innerEdge === 'bottom' ? [strong, weak] : z.innerEdge === 'top' ? [weak, strong] : [strong, strong];
        grad.addColorStop(0, `rgba(${rgb}, ${startA})`);
        grad.addColorStop(1, `rgba(${rgb}, ${endA})`);
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(0, z.top, mediaSize.width, h);
        if (futureRight > futureLeft) {
          ctx.globalAlpha = 1;
          ctx.fillRect(futureLeft, z.top, futureRight - futureLeft, h);
        }
        ctx.globalAlpha = 1;
      }
    });
  }

  draw(target: DrawTarget): void {
    const { zones, deadlineX, nowX, label, profitLabel, lossLabel, markers } = this.geo;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.font = "700 10px 'IBM Plex Mono', monospace";

      for (const z of zones) {
        const h = z.bottom - z.top;
        if (h < 22 || z.innerEdge == null) continue;
        const y = z.innerEdge === 'bottom' ? z.bottom - 8 : z.top + 8;
        ctx.textBaseline = z.innerEdge === 'bottom' ? 'bottom' : 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = `rgba(${z.profit ? PROFIT : LOSS}, 0.85)`;
        ctx.fillText(z.profit ? profitLabel : lossLabel, 10, y);
      }

      if (deadlineX != null && deadlineX <= mediaSize.width + BAR_W) {
        if (zones.length === 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.fillRect(deadlineX - 1, 0, 2, mediaSize.height);
        }
        for (const z of zones) {
          const h = z.bottom - z.top;
          if (h <= 0) continue;
          ctx.fillStyle = `rgba(${z.profit ? PROFIT : LOSS}, 0.95)`;
          ctx.fillRect(deadlineX - BAR_W / 2, z.top, BAR_W, h);
        }

        ctx.font = "600 10px 'IBM Plex Mono', monospace";
        const text = label;
        const w = ctx.measureText(text).width + 12;
        const boxH = 18;
        const boxY = mediaSize.height - boxH - 6;
        const boxX = Math.max(4, deadlineX - BAR_W / 2 - w - 4);
        ctx.fillStyle = 'rgba(17, 17, 17, 0.92)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(boxX, boxY, w, boxH);
        ctx.strokeRect(boxX + 0.5, boxY + 0.5, w - 1, boxH - 1);
        ctx.fillStyle = '#E5E7EB';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, boxX + 6, boxY + boxH / 2 + 0.5);
      }

      if (nowX != null) {
        for (const m of markers) {
          const rgb = m.side === 'up' ? PROFIT : LOSS;
          ctx.beginPath();
          ctx.arc(nowX, m.y, 7, 0, Math.PI * 2);
          ctx.fillStyle = m.sell ? '#111111' : `rgb(${rgb})`;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = `rgb(${rgb})`;
          ctx.stroke();
          ctx.fillStyle = m.sell ? `rgb(${rgb})` : '#0A0A0A';
          ctx.font = "700 9px 'IBM Plex Mono', monospace";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(m.side === 'up' ? '▲' : '▼', nowX, m.y + 0.5);
        }
      }
    });
  }
}

class DeadlinePaneView implements IPrimitivePaneView {
  geo: Geometry = {
    zones: [],
    nowX: null,
    deadlineX: null,
    label: '',
    profitLabel: '',
    lossLabel: '',
    markers: [],
  };

  zOrder(): PrimitivePaneViewZOrder {
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return new DeadlineRenderer(this.geo);
  }
}

/**
 * Paints the trade onto the time axis: profit/loss bands (stronger between
 * "now" and expiry), a payoff-coloured deadline bar at expiry, and a marker
 * per option on the latest candle.
 */
export class DeadlinePrimitive implements ISeriesPrimitive<Time> {
  private zones: readonly PriceZone[] = [];
  private markers: readonly DeadlineMarker[] = [];
  private nowSec: number | null = null;
  private deadlineSec: number | null = null;
  private label = '';
  private profitLabel = '';
  private lossLabel = '';
  private param: SeriesAttachedParameter<Time, SeriesType> | null = null;
  private readonly view = new DeadlinePaneView();
  private readonly views: readonly IPrimitivePaneView[] = [this.view];

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.param = param;
    this.refresh();
  }

  detached(): void {
    this.param = null;
  }

  setState(state: {
    zones: readonly PriceZone[];
    markers: readonly DeadlineMarker[];
    nowSec: number | null;
    deadlineSec: number | null;
    label: string;
    profitLabel: string;
    lossLabel: string;
  }): void {
    this.zones = state.zones;
    this.markers = state.markers;
    this.nowSec = state.nowSec;
    this.deadlineSec = state.deadlineSec;
    this.label = state.label;
    this.profitLabel = state.profitLabel;
    this.lossLabel = state.lossLabel;
    this.refresh();
    this.param?.requestUpdate();
  }

  updateAllViews(): void {
    this.refresh();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private refresh(): void {
    if (!this.param) return;
    const { chart, series } = this.param;
    const height = chart.paneSize().height;
    const timeScale = chart.timeScale();
    const toX = (sec: number | null): number | null => {
      if (sec == null) return null;
      const x = timeScale.timeToCoordinate(sec as Time);
      return x == null ? null : Number(x);
    };

    const markers: Geometry['markers'] = [];
    for (const m of this.markers) {
      const y = series.priceToCoordinate(m.price);
      if (y != null) markers.push({ y: Number(y), side: m.side, sell: m.sell });
    }

    this.view.geo = {
      zones: pixelZones(this.zones, series, height),
      nowX: toX(this.nowSec),
      deadlineX: toX(this.deadlineSec),
      label: this.label,
      profitLabel: this.profitLabel,
      lossLabel: this.lossLabel,
      markers,
    };
  }
}

function pixelZones(
  zones: readonly PriceZone[],
  series: ISeriesApi<SeriesType>,
  height: number,
): PixelZone[] {
  if (height <= 0 || zones.length === 0) return [];
  const top = series.coordinateToPrice(0);
  const bottom = series.coordinateToPrice(height);
  if (top == null || bottom == null) return [];
  const hi = Math.max(Number(top), Number(bottom));
  const lo = Math.min(Number(top), Number(bottom));
  const toY = (price: number, upper: boolean): number => {
    if (!Number.isFinite(price)) return upper ? 0 : height;
    if (price >= hi) return 0;
    if (price <= lo) return height;
    const y = series.priceToCoordinate(price);
    return y == null ? (upper ? 0 : height) : Math.max(0, Math.min(height, Number(y)));
  };

  const out: PixelZone[] = [];
  for (const z of zones) {
    const yTop = toY(z.high, true);
    const yBottom = toY(z.low, false);
    if (yBottom <= yTop) continue;
    const highIsBe = Number.isFinite(z.high);
    const lowIsBe = Number.isFinite(z.low);
    let innerEdge: PixelZone['innerEdge'] = null;
    if (lowIsBe && !highIsBe) innerEdge = 'bottom';
    else if (highIsBe && !lowIsBe) innerEdge = 'top';
    else if (highIsBe && lowIsBe) innerEdge = 'bottom';
    out.push({ top: yTop, bottom: yBottom, profit: z.profit, innerEdge });
  }
  return out;
}
