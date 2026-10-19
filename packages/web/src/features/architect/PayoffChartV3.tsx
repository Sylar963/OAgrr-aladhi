import { useEffect, useMemo, useRef, useState } from 'react';

import { dteDays, fmtIv, fmtPct, fmtPrice, fmtStrike, fmtUsd, formatExpiry } from '@lib/format';
import { computeMetrics, type Leg, type PayoffPoint } from './payoff';
import {
  buildLadderUnits,
  buildLadderZones,
  buildPnlGrid,
  deriveLadderDomain,
  expectedMoveBand,
  gridRowEdges,
  gridTimeEdges,
  legToBlock,
  makePriceScale,
  makeTimeScale,
  nearestAtmIv,
  netPnlReadout,
  packLanes,
  spreadKey,
  type LadderBlock,
  type LadderSpread,
  type PnlGridCell,
} from './ladder-geometry';
import type { SpotCandle } from './queries';
import s from './PayoffChartV3.module.css';

interface PayoffChartV3Props {
  points: PayoffPoint[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  netDebit: number;
  strikes?: number[];
  /** Expiry columns for the horizontal time axis; none → boxes span the whole future pane. */
  tenors?: string[];
  /** The builder's live (WS-subscribed) expiry — its column gets highlighted. */
  activeTenor?: string;
  /** Underlying price history drawn left of "now"; empty → no history pane. */
  candles?: SpotCandle[];
  /** Header caption for the history pane, e.g. "1H". */
  candleIntervalLabel?: string;
  onLegStrikeDrag?: (legId: string, newStrike: number) => void;
  /** A box was dragged onto another tenor (strike = dragged rung). */
  onLegTenorDrag?: (legId: string, newExpiry: string, strike: number) => void;
  onAddLegAtStrike?: (
    strike: number,
    type: 'call' | 'put',
    direction: 'buy' | 'sell',
    quantity: number,
    expiry?: string,
  ) => void;
  onRemoveLeg?: (legId: string) => void;
}

const PAD = { top: 18, right: 72, bottom: 18, left: 52 };
/** Share of the plot width given to price history when candles are present. */
const HISTORY_FRAC = 0.3;
const CANDLE_STEP = 7;
const MIN_BOX_PX = 8;
/** Order-line chip pinned to each box's strike edge. */
const CHIP_H = 16;
const CHIP_CHAR_PX = 6.1;
/** Horizontal offset between chips of boxes whose price spans overlap. */
const CHIP_LANE_STEP = 150;
/** Vertical room per strike rung; the ladder grows (and scrolls) with rung count. */
const PX_PER_RUNG = 48;
/** Height of the sticky time header strip. */
const HEADER_H = 24;
/** Horizontal pointer travel before a drag can hop tenors. */
const TENOR_DRAG_ENGAGE_PX = 20;
/** Target edge length of a P&L grid square. */
const CELL_PX = 24;
const CONE_SAMPLES = 48;

/** Map a price to a clamped pixel y inside the plot; ±Infinity → plot edges. */
function clampY(price: number, yOf: (p: number) => number, plotTop: number, plotBottom: number): number {
  if (price === Infinity) return plotTop;
  if (price === -Infinity) return plotBottom;
  return Math.max(plotTop, Math.min(plotBottom, yOf(price)));
}

function nearestStrike(price: number, strikes: number[]): number | null {
  if (strikes.length === 0) return null;
  return strikes.reduce((best, k) => (Math.abs(k - price) < Math.abs(best - price) ? k : best));
}

function chipText(block: LadderBlock): string {
  return `${block.label} · ${fmtUsd(block.premium)}`;
}

export default function PayoffChartV3({
  breakevens,
  spotPrice,
  legs,
  netDebit,
  strikes = [],
  tenors,
  activeTenor,
  candles = [],
  candleIntervalLabel,
  onLegStrikeDrag,
  onLegTenorDrag,
  onAddLegAtStrike,
  onRemoveLeg,
}: PayoffChartV3Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Default to a non-zero size so the chart renders before (and without) a live
  // ResizeObserver — jsdom has no ResizeObserver, and the first paint has no box.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 400 });
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverLegId, setHoverLegId] = useState<string | null>(null);
  const [hoverSpreadKey, setHoverSpreadKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    legId: string;
    strike: number;
    expiry: string;
    startClientX: number;
  } | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; strike: number; expiry?: string } | null>(
    null,
  );
  const [removingId, setRemovingId] = useState<string | null>(null);
  const justDraggedRef = useRef(false);

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const requestRemove = (legId: string) => {
    if (!onRemoveLeg) return;
    if (reduceMotion) {
      onRemoveLeg(legId);
      return;
    }
    setRemovingId(legId);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr && cr.width > 0 && cr.height > 0) setSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const seenIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    seenIds.current = new Set(legs.map((l) => l.id));
  });

  const { w, h: viewportH } = size;
  const plotLeft = PAD.left;
  const plotRight = w - PAD.right;
  const plotW = Math.max(1, plotRight - plotLeft);

  // Past | future split: candles fill the left pane up to "now", the trade's
  // boxes live to the right of it.
  const histW = candles.length > 0 ? Math.round(plotW * HISTORY_FRAC) : 0;
  const nowX = plotLeft + histW;
  const futureW = Math.max(1, plotRight - nowX);
  const shownCandles = useMemo(
    () => (histW > 0 ? candles.slice(-Math.max(1, Math.floor(histW / CANDLE_STEP))) : []),
    [candles, histW],
  );
  const candleRange = useMemo(() => {
    if (shownCandles.length === 0) return [];
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of shownCandles) {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    }
    return [lo, hi];
  }, [shownCandles]);

  const viewLegs = useMemo(
    () =>
      drag
        ? legs.map((l) =>
            l.id === drag.legId ? { ...l, strike: drag.strike, expiry: drag.expiry } : l,
          )
        : legs,
    [legs, drag],
  );
  const viewBreakevens = useMemo(
    () => (drag ? computeMetrics(viewLegs, spotPrice).breakevens : breakevens),
    [drag, viewLegs, spotPrice, breakevens],
  );
  const blocks = useMemo(() => viewLegs.map(legToBlock), [viewLegs]);

  const domain = useMemo(
    () => deriveLadderDomain(blocks, viewBreakevens, spotPrice, strikes, undefined, candleRange),
    [blocks, viewBreakevens, spotPrice, strikes, candleRange],
  );
  const rungs = domain.rungs;
  const span = domain.priceMax - domain.priceMin || 1;

  // The ladder is taller than the viewport when there are many rungs — the
  // container scrolls. price→y maps over this intrinsic content height, not the
  // viewport, so boxes get real vertical room instead of being force-fit.
  const plotTop = PAD.top;
  const contentH = Math.max(viewportH, rungs.length * PX_PER_RUNG + PAD.top + PAD.bottom);
  const plotBottom = contentH - PAD.bottom;
  const plotH = Math.max(1, plotBottom - plotTop);
  const scale = useMemo(
    () => makePriceScale(domain.priceMin, domain.priceMax, plotTop, plotH),
    [domain, plotTop, plotH],
  );

  // Calendar-time axis over the future pane (now → last expiry), so theta reads
  // honestly: equal widths are equal days, expiries land where they occur.
  const nowMs = Math.floor(Date.now() / 60_000) * 60_000;
  const tenorScale = useMemo(
    () => (tenors && tenors.length > 0 ? makeTimeScale(tenors, nowX, futureW, nowMs) : null),
    [tenors, nowX, futureW, nowMs],
  );
  const showHeader = tenorScale != null || histW > 0;

  /** Horizontal extent of a position: from now until its expiry. */
  const boxSpan = (expiry: string): { x0: number; x1: number } => {
    const x0 = nowX + 1;
    const xe = tenorScale?.xExpiry(expiry);
    return { x0, x1: xe != null ? Math.max(x0 + 24, xe) : plotRight - 2 };
  };
  const nearestTenor = (xPx: number): string | null => {
    if (!tenorScale) return null;
    let best: string | null = null;
    let bestD = Infinity;
    for (const t of tenorScale.tenors) {
      const d = Math.abs((tenorScale.xExpiry(t) ?? 0) - xPx);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  };

  // Render units fuse clean verticals into one spread box. Lanes only fan out
  // the order-line chips of boxes whose price spans overlap.
  const units = useMemo(() => buildLadderUnits(viewLegs), [viewLegs]);
  const lanes = useMemo(
    () =>
      packLanes(
        units.map((u) =>
          u.kind === 'spread'
            ? { legId: spreadKey(u.spread), spanLowPrice: u.spread.lowStrike, spanHighPrice: u.spread.highStrike }
            : { legId: u.block.legId, spanLowPrice: u.block.spanLowPrice, spanHighPrice: u.block.spanHighPrice },
        ),
      ),
    [units],
  );
  const zones = useMemo(
    () => buildLadderZones(viewLegs, viewBreakevens, spotPrice),
    [viewLegs, viewBreakevens, spotPrice],
  );

  const spotY = clampY(spotPrice, scale.y, plotTop, plotBottom);

  const gridLayer = useMemo(() => {
    if (!tenorScale || viewLegs.length === 0) return null;
    const timeEdges = gridTimeEdges(tenorScale.nowMs, tenorScale.endMs, Math.floor(futureW / CELL_PX));
    const priceEdges = gridRowEdges(rungs, domain.priceMin, domain.priceMax, plotH / span, CELL_PX);
    const grid = buildPnlGrid(viewLegs, timeEdges, priceEdges);
    if (grid.maxAbs === 0) return null;
    const cellBox = (c: PnlGridCell) => {
      const x0 = tenorScale.xOf(c.t0Ms);
      const yTop = scale.y(c.highPrice);
      return {
        x: x0 + 0.5,
        y: yTop + 0.5,
        width: Math.max(0, tenorScale.xOf(c.t1Ms) - x0 - 1),
        height: Math.max(0, scale.y(c.lowPrice) - yTop - 1),
      };
    };
    const spotRow = grid.cells.filter((c) => spotPrice >= c.lowPrice && spotPrice < c.highPrice);
    return (
      <g data-testid="pnl-grid" pointerEvents="none">
        {grid.cells.map((c) => (
          <rect
            key={`${c.t0Ms}:${c.lowPrice}`}
            {...cellBox(c)}
            rx={1.5}
            fill={c.pnl >= 0 ? 'var(--lego-profit)' : 'var(--lego-loss)'}
            opacity={0.04 + 0.22 * Math.sqrt(Math.abs(c.pnl) / grid.maxAbs)}
          />
        ))}
        {/* Current-price row: where the position sits today, followed through time */}
        {spotRow.map((c, i) => (
          <rect
            key={`spot:${c.t0Ms}`}
            data-spot-cell={i === 0 ? 'now' : 'row'}
            {...cellBox(c)}
            rx={1.5}
            fill="var(--lego-be)"
            fillOpacity={i === 0 ? 0.35 : 0.06}
            stroke="var(--lego-be)"
            strokeOpacity={i === 0 ? 0.8 : 0.25}
            strokeWidth={1}
          />
        ))}
      </g>
    );
  }, [tenorScale, viewLegs, rungs, domain, futureW, plotH, span, scale, spotPrice]);

  const historyLayer = useMemo(() => {
    if (shownCandles.length === 0) return null;
    const n = shownCandles.length;
    const bodyW = CANDLE_STEP - 2;
    const xCenter = (i: number) => nowX - 3 - (n - i - 0.5) * CANDLE_STEP;
    const last = shownCandles[n - 1]!;
    return (
      <g data-testid="price-history" pointerEvents="none" clipPath="url(#lego-history-clip)">
        {shownCandles.map((c, i) => {
          const up = c.close >= c.open;
          const color = up ? 'var(--lego-up)' : 'var(--lego-down)';
          const cx = xCenter(i);
          const yO = scale.y(c.open);
          const yC = scale.y(c.close);
          return (
            <g key={c.timestamp} data-candle={up ? 'up' : 'down'}>
              <line x1={cx} y1={scale.y(c.high)} x2={cx} y2={scale.y(c.low)} stroke={color} strokeWidth={1} />
              <rect
                x={cx - bodyW / 2}
                y={Math.min(yO, yC)}
                width={bodyW}
                height={Math.max(1, Math.abs(yC - yO))}
                fill={color}
              />
            </g>
          );
        })}
        <line
          x1={xCenter(n - 1)}
          y1={scale.y(last.close)}
          x2={nowX}
          y2={spotY}
          stroke="var(--accent-primary)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      </g>
    );
  }, [shownCandles, nowX, scale, spotY]);

  const coneIv = useMemo(() => nearestAtmIv(legs, spotPrice), [legs, spotPrice]);
  const conePaths = useMemo(() => {
    if (!tenorScale || coneIv == null || !(spotPrice > 0)) return null;
    const { nowMs: t0, endMs } = tenorScale;
    const path = (k: number, side: 'low' | 'high') =>
      Array.from({ length: CONE_SAMPLES + 1 }, (_, i) => {
        const t = t0 + ((endMs - t0) * i) / CONE_SAMPLES;
        const band = expectedMoveBand(spotPrice, coneIv, t0, t, k);
        const y = clampY(band[side], scale.y, plotTop, plotBottom);
        return `${i === 0 ? 'M' : 'L'}${tenorScale.xOf(t).toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
    return [1, 2].map((k) => ({ k, d: `${path(k, 'high')} ${path(k, 'low')}` }));
  }, [tenorScale, coneIv, spotPrice, scale, plotTop, plotBottom]);

  // When the ladder overflows the viewport, center it on spot once so the live
  // action is in view; let the user scroll freely after that.
  const headerH = showHeader ? HEADER_H : 0;
  const didCenterRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (contentH <= viewportH) {
      didCenterRef.current = false;
      return;
    }
    if (didCenterRef.current) return;
    el.scrollTop = Math.max(0, spotY + headerH - viewportH / 2);
    didCenterRef.current = true;
  }, [contentH, viewportH, spotY, headerH]);

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag && e.buttons === 0) {
      endDrag();
      return;
    }
    // The SVG's own rect already accounts for scroll and the header, so client
    // coords map straight into SVG space.
    const svgRect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - svgRect.top;
    if (drag) {
      const price = scale.priceAt(Math.max(plotTop, Math.min(plotBottom, y)));
      const snapped = nearestStrike(price, strikes);
      let next = drag;
      if (snapped != null && snapped !== next.strike) next = { ...next, strike: snapped };
      if (tenorScale && onLegTenorDrag) {
        // A box spans now→expiry, so the gesture moves its expiry edge by the
        // pointer's travel and snaps to the nearest listed expiry. Hops engage
        // only past a deliberate threshold so a wobbly vertical drag stays home.
        const dx = e.clientX - drag.startClientX;
        const home = legs.find((l) => l.id === drag.legId)?.expiry ?? next.expiry;
        const homeX = tenorScale.xExpiry(home);
        const target =
          Math.abs(dx) > TENOR_DRAG_ENGAGE_PX && homeX != null
            ? (nearestTenor(homeX + dx) ?? home)
            : home;
        if (target !== next.expiry) next = { ...next, expiry: target };
      }
      if (next !== drag) setDrag(next);
      return;
    }
    setHoverY(y >= plotTop && y <= plotBottom ? y : null);
    setHoverX(e.clientX - svgRect.left);
  };
  // NOTE: deliberately does NOT clear the picker — the picker overlay is a
  // sibling of the svg, so moving the mouse onto it fires the svg's
  // pointerleave first and would dismiss it before any button could be
  // clicked. The picker closes on container leave (below) or button click.
  const handlePointerLeave = () => {
    setHoverY(null);
    setHoverX(null);
    setHoverLegId(null);
    setHoverSpreadKey(null);
  };
  const endDrag = () => {
    if (drag) {
      justDraggedRef.current = true;
      const original = legs.find((l) => l.id === drag.legId);
      if (original) {
        // A tenor hop wins (it carries the dragged strike with it, so a
        // diagonal move reprices both at once on the target tenor's grid).
        if (onLegTenorDrag && drag.expiry !== original.expiry) {
          onLegTenorDrag(drag.legId, drag.expiry, drag.strike);
        } else if (onLegStrikeDrag && original.strike !== drag.strike) {
          onLegStrikeDrag(drag.legId, drag.strike);
        }
      }
    }
    setDrag(null);
  };
  const handleLadderClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (!onAddLegAtStrike || drag) return;
    // Native `click` bubbles from boxes (whose stopPropagation is on
    // pointerdown, not click); ignore clicks landing on a box so it can't open a
    // picker over it or double-fire with the remove control.
    if ((e.target as Element).closest('[data-leg-id], [data-spread-key]')) return;
    const svgRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - svgRect.left;
    const y = e.clientY - svgRect.top;
    if (y < plotTop || y > plotBottom) return;
    const snapped = nearestStrike(scale.priceAt(y), strikes);
    if (snapped == null) return;
    const expiry = tenorScale ? (tenorScale.tenorAt(x) ?? undefined) : undefined;
    setPicker({ x, y, strike: snapped, expiry });
  };

  const hoverPrice = hoverY != null ? scale.priceAt(hoverY) : null;
  const hoverMs =
    tenorScale && hoverX != null
      ? Math.max(tenorScale.nowMs, Math.min(tenorScale.endMs, tenorScale.timeAt(hoverX)))
      : null;
  const hoverReadout =
    hoverPrice != null ? netPnlReadout(legs, hoverPrice, netDebit, hoverMs ?? undefined) : null;
  const hoveredLeg = hoverLegId != null ? legs.find((l) => l.id === hoverLegId) ?? null : null;
  const hoveredSpread = ((): LadderSpread | null => {
    if (hoverSpreadKey == null) return null;
    for (const u of units) {
      if (u.kind === 'spread' && spreadKey(u.spread) === hoverSpreadKey) return u.spread;
    }
    return null;
  })();

  const chipXFor = (key: string, x0: number) => x0 + 8 + (lanes.get(key) ?? 0) * CHIP_LANE_STEP;

  const renderBox = (
    block: LadderBlock,
    key: string,
    active: boolean,
    handlers: { onEnter?: () => void; onLeave?: () => void },
  ) => {
    const { x0, x1 } = boxSpan(block.expiry);
    return (
      <PositionBox
        key={block.legId}
        block={block}
        x0={x0}
        x1={x1}
        chipX={chipXFor(key, x0)}
        histLeft={plotLeft}
        tagX={plotRight + 2}
        yOf={scale.y}
        plotTop={plotTop}
        plotBottom={plotBottom}
        active={active}
        dragging={drag?.legId === block.legId}
        isNew={!seenIds.current.has(block.legId)}
        onEnter={handlers.onEnter}
        onLeave={handlers.onLeave}
        onDragStart={(e) =>
          setDrag({ legId: block.legId, strike: block.strike, expiry: block.expiry, startClientX: e.clientX })
        }
        onRemove={onRemoveLeg ? () => requestRemove(block.legId) : undefined}
        exiting={removingId === block.legId}
        onExitEnd={() => {
          onRemoveLeg?.(block.legId);
          setRemovingId(null);
        }}
      />
    );
  };

  return (
    <div className={s.container} ref={containerRef} onPointerLeave={() => setPicker(null)}>
      {showHeader && (
        <div className={s.tenorHeader} style={{ height: HEADER_H }}>
          {histW > 0 && (
            <span className={s.historyLabel} style={{ left: plotLeft + histW / 2 }}>
              price{candleIntervalLabel ? ` · ${candleIntervalLabel}` : ''}
            </span>
          )}
          <span className={s.tenorLabel} data-now="true" style={{ left: nowX }}>
            now
          </span>
          {tenorScale?.tenors.map((t) => (
            <span
              key={t}
              className={s.tenorLabel}
              data-tenor={t}
              data-active={t === activeTenor}
              style={{ left: tenorScale.xExpiry(t) ?? 0 }}
            >
              {formatExpiry(t)}
              <span className={s.tenorDte}>{dteDays(t)}d</span>
            </span>
          ))}
        </div>
      )}
      <div className={s.plotWrap}>
      <svg
        className={s.svg}
        style={{ height: contentH }}
        viewBox={`0 0 ${w} ${contentH}`}
        preserveAspectRatio="none"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={handleLadderClick}
      >
        <defs>
          <pattern id="lego-hatch-call" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--lego-call)" strokeWidth="1.2" opacity="0.6" />
          </pattern>
          <pattern id="lego-hatch-put" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--lego-put)" strokeWidth="1.2" opacity="0.6" />
          </pattern>
          <clipPath id="lego-history-clip">
            <rect x={plotLeft} y={plotTop} width={histW} height={plotH} />
          </clipPath>
        </defs>

        {/* Net P&L: price × time grid on the calendar axis, at-expiry wash otherwise */}
        {gridLayer}
        {!gridLayer && zones.map((z, i) => {
          const yHigh = clampY(z.highPrice, scale.y, plotTop, plotBottom);
          const yLow = clampY(z.lowPrice, scale.y, plotTop, plotBottom);
          return (
            <rect
              key={`zone-${i}`}
              className={s.zone}
              x={nowX}
              y={yHigh}
              width={futureW}
              height={Math.max(0, yLow - yHigh)}
              fill={z.profit ? 'var(--lego-profit)' : 'var(--lego-loss)'}
              opacity={0.09}
            />
          );
        })}

        {/* Active tenor tint + expiry gridlines */}
        {tenorScale &&
          activeTenor &&
          (() => {
            const seg = tenorScale.segment(activeTenor);
            return seg == null ? null : (
              <rect
                x={seg.x0}
                y={plotTop}
                width={Math.max(0, seg.x1 - seg.x0)}
                height={plotH}
                fill="var(--accent-primary)"
                opacity={0.03}
                pointerEvents="none"
              />
            );
          })()}
        {tenorScale?.tenors.map((t) => {
            const x = tenorScale.xExpiry(t)!;
            return (
              <line
                key={`tcol-${t}`}
                data-expiry-line={t}
                x1={x}
                y1={plotTop}
                x2={x}
                y2={plotBottom}
                stroke="var(--text-tertiary)"
                strokeWidth="1"
                strokeDasharray="3 4"
                opacity={0.45}
                pointerEvents="none"
              />
            );
          })}

        {/* Strike rungs — every listed strike, printed exactly */}
        {rungs.map((k) => {
          const y = scale.y(k);
          if (y < plotTop || y > plotBottom) return null;
          return (
            <g key={`rung-${k}`} className={s.rung}>
              <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
              <text x={plotLeft - 4} y={y + 3} fill="var(--text-tertiary)" fontSize="9" textAnchor="end">
                {fmtStrike(k)}
              </text>
            </g>
          );
        })}

        {historyLayer}
        {histW > 0 && (
          <line
            data-now-line="true"
            x1={nowX}
            y1={plotTop}
            x2={nowX}
            y2={plotBottom}
            stroke="var(--text-secondary)"
            strokeWidth="1"
            strokeDasharray="4 3"
            opacity={0.6}
            pointerEvents="none"
          />
        )}

        {/* Break-even lines */}
        {viewBreakevens.map((be, i) => {
          const y = scale.y(be);
          if (y < plotTop || y > plotBottom) return null;
          return (
            <g key={`be-${i}`}>
              <line className={s.beLine} x1={nowX} y1={y} x2={plotRight} y2={y} stroke="var(--lego-be)" strokeWidth="1.3" strokeDasharray="5 3" />
              <text x={plotLeft - 4} y={y + 3} fill="var(--lego-be)" fontSize="9" textAnchor="end">
                {fmtPrice(be)}
              </text>
            </g>
          );
        })}

        {/* Spot line + last-price tag on the right axis */}
        <line x1={plotLeft} y1={spotY} x2={plotRight} y2={spotY} stroke="var(--accent-primary)" strokeWidth="1" opacity={0.7} />
        <g data-spot-tag="true" pointerEvents="none">
          <rect x={plotRight + 2} y={spotY - 8} width={PAD.right - 4} height={16} rx={3} fill="var(--accent-primary)" />
          <text x={plotRight + 6} y={spotY + 3} fill="var(--bg-base)" fontSize="9" fontWeight={600}>
            {fmtPrice(spotPrice)}
          </text>
        </g>

        {/* Expected-move cone (±1σ dashed, ±2σ dotted) from spot, now */}
        {conePaths?.map(({ k, d }) => (
          <path
            key={`cone-${k}`}
            data-cone={k}
            d={d}
            fill="none"
            stroke="var(--accent-primary)"
            strokeWidth={k === 1 ? 1.3 : 1}
            strokeDasharray={k === 1 ? '6 4' : '2 4'}
            opacity={k === 1 ? 0.6 : 0.35}
            pointerEvents="none"
          />
        ))}
        <circle cx={nowX} cy={spotY} r={4} fill="var(--accent-primary)" pointerEvents="none" />

        {/* Positions — fused spreads + lone legs */}
        {units.map((u) => {
          if (u.kind === 'spread') {
            const sp = u.spread;
            const key = spreadKey(sp);
            const { x0, x1 } = boxSpan(sp.expiry);
            const spreadActive =
              hoverSpreadKey === key || drag?.legId === sp.longLegId || drag?.legId === sp.shortLegId;
            const cTop = clampY(sp.highStrike, scale.y, plotTop, plotBottom);
            const cBot = clampY(sp.lowStrike, scale.y, plotTop, plotBottom);
            const hue = sp.type === 'call' ? 'var(--lego-call)' : 'var(--lego-put)';
            return (
              <g
                key={key}
                data-spread-key={key}
                data-active={spreadActive}
                onPointerEnter={() => setHoverSpreadKey(key)}
                onPointerLeave={() => setHoverSpreadKey(null)}
              >
                {/* defined-risk corridor between the two strikes */}
                <rect
                  className={s.spreadCorridor}
                  x={x0}
                  y={cTop}
                  width={Math.max(0, x1 - x0)}
                  height={Math.max(0, cBot - cTop)}
                  fill={hue}
                  fillOpacity={0.1}
                  stroke={hue}
                  strokeOpacity={0.45}
                  strokeDasharray="2 3"
                />
                {renderBox(sp.longBlock, key, spreadActive, {})}
                {renderBox(sp.shortBlock, key, spreadActive, {})}
              </g>
            );
          }
          return renderBox(
            u.block,
            u.block.legId,
            hoverLegId === u.block.legId || drag?.legId === u.block.legId,
            {
              onEnter: () => setHoverLegId(u.block.legId),
              onLeave: () => setHoverLegId(null),
            },
          );
        })}
      </svg>

      {hoverY != null && hoverReadout != null && hoverLegId == null && hoverSpreadKey == null && (
        <div className={s.crosshairChip} data-testid="crosshair-chip" style={{ left: plotLeft + 6, top: hoverY }}>
          @{fmtPrice(hoverPrice as number)}
          {hoverMs != null ? ` · ${formatExpiry(new Date(hoverMs).toISOString().slice(0, 10))}` : ''} →{' '}
          {fmtUsd(hoverReadout.pnl)}
          {hoverReadout.pct != null ? ` (${fmtPct(hoverReadout.pct, 0)})` : ''}
        </div>
      )}

      {hoveredLeg != null && (
        <div
          className={s.card}
          style={{
            left: Math.min(boxSpan(hoveredLeg.expiry).x1 + 8, w - 150),
            top: scale.y(hoveredLeg.strike) - 40,
          }}
        >
          <div className={s.cardTitle}>{legToBlock(hoveredLeg).label}</div>
          <div>prem {fmtUsd(hoveredLeg.entryPrice)}</div>
          <div>IV {fmtIv(hoveredLeg.iv)}</div>
          <div>Δ {hoveredLeg.delta != null ? hoveredLeg.delta.toFixed(2) : '–'} · Θ {hoveredLeg.theta != null ? hoveredLeg.theta.toFixed(2) : '–'}</div>
          <div>P/L @spot {fmtUsd(netPnlReadout([hoveredLeg], spotPrice, hoveredLeg.entryPrice).pnl)}</div>
        </div>
      )}

      {hoveredSpread != null &&
        (() => {
          const lLeg = legs.find((l) => l.id === hoveredSpread.longLegId);
          const sLeg = legs.find((l) => l.id === hoveredSpread.shortLegId);
          if (!lLeg || !sLeg) return null;
          const m = computeMetrics([lLeg, sLeg], spotPrice);
          const midY = scale.y((hoveredSpread.lowStrike + hoveredSpread.highStrike) / 2);
          return (
            <div
              className={s.card}
              style={{ left: Math.min(boxSpan(hoveredSpread.expiry).x1 + 8, w - 150), top: midY - 48 }}
            >
              <div className={s.cardTitle}>{hoveredSpread.label} spread</div>
              <div>long +{lLeg.quantity} {hoveredSpread.type === 'call' ? 'C' : 'P'} {fmtStrike(lLeg.strike)}</div>
              <div>short −{sLeg.quantity} {hoveredSpread.type === 'call' ? 'C' : 'P'} {fmtStrike(sLeg.strike)}</div>
              <div>{m.netDebit < 0 ? 'debit' : 'credit'} {fmtUsd(Math.abs(m.netDebit))}</div>
              <div>
                max {m.maxProfit != null ? fmtUsd(m.maxProfit) : '∞'} / {m.maxLoss != null ? fmtUsd(m.maxLoss) : '∞'}
              </div>
            </div>
          );
        })()}

      {picker && onAddLegAtStrike && (
        <div
          className={s.picker}
          style={{ left: Math.max(4, Math.min(w - 260, picker.x - 70)), top: picker.y }}
        >
          {(['buy', 'sell'] as const).flatMap((direction) =>
            (['call', 'put'] as const).map((type) => (
              <button
                key={`${direction}-${type}`}
                type="button"
                data-add={`${direction}-${type}`}
                className={s.pickerBtn}
                onClick={() => {
                  onAddLegAtStrike(picker.strike, type, direction, 1, picker.expiry);
                  setPicker(null);
                }}
              >
                {direction === 'buy' ? '+' : '−'}
                {type === 'call' ? 'C' : 'P'} {fmtStrike(picker.strike)}
              </button>
            )),
          )}
        </div>
      )}
      </div>

      {legs.length === 0 && <div className={s.empty}>Click the chart at a strike to place a position</div>}
    </div>
  );
}

interface PositionBoxProps {
  block: LadderBlock;
  /** Box runs from now (x0) to the leg's expiry (x1). */
  x0: number;
  x1: number;
  chipX: number;
  /** Left edge of the history pane — the strike's order line extends back to it. */
  histLeft: number;
  /** Left edge of the right-axis price tag. */
  tagX: number;
  yOf: (price: number) => number;
  plotTop: number;
  plotBottom: number;
  active: boolean;
  dragging: boolean;
  isNew: boolean;
  exiting: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onRemove?: () => void;
  onExitEnd: () => void;
}

/**
 * One leg as a trading position: a box from now to expiry spanning strike →
 * break-even, with an order line + chip on the strike and a tag on the price axis.
 */
function PositionBox({
  block,
  x0,
  x1,
  chipX,
  histLeft,
  tagX,
  yOf,
  plotTop,
  plotBottom,
  active,
  dragging,
  isNew,
  exiting,
  onEnter,
  onLeave,
  onDragStart,
  onRemove,
  onExitEnd,
}: PositionBoxProps) {
  // Native `animationend` (not React's onAnimationEnd) so the keyframe-driven exit
  // resolves in jsdom too: jsdom has no AnimationEvent, so React never routes its
  // synthetic onAnimationEnd, but a native listener still fires.
  const groupRef = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = groupRef.current;
    if (!el || !exiting) return;
    const handle = () => onExitEnd();
    el.addEventListener('animationend', handle);
    return () => el.removeEventListener('animationend', handle);
  }, [exiting, onExitEnd]);

  const isCall = block.type === 'call';
  const isLong = block.direction === 'buy';
  const hue = isCall ? 'var(--lego-call)' : 'var(--lego-put)';
  const hatch = isCall ? 'url(#lego-hatch-call)' : 'url(#lego-hatch-put)';
  const clamp = (y: number) => Math.max(plotTop, Math.min(plotBottom, y));

  const yStrike = clamp(yOf(block.strike));
  // Call boxes grow up from the strike (premium sits above it), puts grow down.
  const rawTop = clamp(yOf(block.spanHighPrice));
  const rawBottom = clamp(yOf(block.spanLowPrice));
  const height = Math.max(MIN_BOX_PX, rawBottom - rawTop);
  const yTop = isCall ? Math.min(rawTop, yStrike - height) : yStrike;
  const width = Math.max(0, x1 - x0);
  const beEdgeY = isCall ? yTop : yTop + height;

  const ax = x1 - 12;
  const arrowApexY = isCall
    ? (isLong ? yTop - 12 : yTop + Math.min(14, height))
    : (isLong ? yTop + height + 12 : yTop + height - Math.min(14, height));
  const arrowBaseY = isCall
    ? (isLong ? yTop : yTop + 2)
    : (isLong ? yTop + height : yTop + height - 2);

  const text = chipText(block);
  const chipW = text.length * CHIP_CHAR_PX + 12;
  const cx = Math.min(chipX, Math.max(x0 + 4, x1 - chipW - 26));
  const chipY = isCall ? yStrike - CHIP_H : yStrike;

  return (
    <g
      ref={groupRef}
      className={`${s.block} ${isNew ? s.blockEnter : ''} ${exiting ? s.blockExit : ''}`}
      data-leg-id={block.legId}
      data-active={active}
      data-dragging={dragging}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDragStart(e);
      }}
    >
      <rect
        x={x0}
        y={yTop}
        width={width}
        height={height}
        fill={isLong ? hue : hatch}
        fillOpacity={isLong ? 0.22 : 1}
        stroke={hue}
        strokeWidth={1}
        strokeOpacity={0.7}
        strokeDasharray={isLong ? undefined : '4 3'}
      />
      {/* Order line: faint through the history pane, solid across the position */}
      <line
        x1={histLeft}
        y1={yStrike}
        x2={x0}
        y2={yStrike}
        stroke={hue}
        strokeWidth={1}
        strokeDasharray="2 3"
        opacity={0.45}
        pointerEvents="none"
      />
      <line data-strike-line="true" x1={x0} y1={yStrike} x2={x1} y2={yStrike} stroke={hue} strokeWidth={2} />
      {/* Short: red cap bar on the break-even edge */}
      {!isLong && (
        <line x1={x0} y1={beEdgeY} x2={x1} y2={beEdgeY} stroke="var(--lego-loss)" strokeWidth="2.5" />
      )}
      {/* Expiry edge */}
      <line x1={x1} y1={yTop} x2={x1} y2={yTop + height} stroke={hue} strokeWidth={2} />
      {/* Direction arrow at the expiry end */}
      <polygon points={`${ax},${arrowApexY} ${ax - 6},${arrowBaseY} ${ax + 6},${arrowBaseY}`} fill={hue} />

      <g>
        <rect
          x={cx}
          y={chipY}
          width={chipW}
          height={CHIP_H}
          rx={3}
          fill="var(--bg-panel)"
          stroke={hue}
          strokeWidth={1}
        />
        <rect x={cx} y={chipY} width={3} height={CHIP_H} rx={1} fill={isLong ? 'var(--lego-profit)' : 'var(--lego-loss)'} />
        <text x={cx + 8} y={chipY + CHIP_H / 2 + 3.5} fill="var(--text-primary)" fontSize="10">
          {text}
        </text>
      </g>
      {onRemove && (
        <g data-remove-leg={block.legId} style={{ cursor: 'pointer' }} onClick={onRemove}>
          <circle cx={cx + chipW + 10} cy={chipY + CHIP_H / 2} r={7} fill="var(--bg-elevated)" stroke="var(--lego-loss)" />
          <text x={cx + chipW + 10} y={chipY + CHIP_H / 2 + 3} fill="var(--lego-loss)" fontSize="9" textAnchor="middle">×</text>
        </g>
      )}

      {/* Price-axis tag */}
      <g data-strike-tag={block.legId} pointerEvents="none">
        <rect x={tagX} y={yStrike - 8} width={PAD.right - 4} height={16} rx={3} fill={hue} fillOpacity={0.9} />
        <text x={tagX + 4} y={yStrike + 3} fill="var(--bg-base)" fontSize="9" fontWeight={600}>
          {fmtStrike(block.strike)}
        </text>
      </g>
    </g>
  );
}
