import { useEffect, useMemo, useRef, useState } from 'react';

import { fmtIv, fmtPct, fmtUsd } from '@lib/format';
import { computeMetrics, type Leg, type PayoffPoint } from './payoff';
import {
  buildLadderUnits,
  buildLadderZones,
  deriveLadderDomain,
  formatPriceTick,
  legToBlock,
  makePriceScale,
  netPnlReadout,
  packLanes,
  spreadKey,
  type LadderBlock,
  type LadderSpread,
} from './ladder-geometry';
import s from './PayoffChartV3.module.css';

interface PayoffChartV3Props {
  points: PayoffPoint[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  netDebit: number;
  strikes?: number[];
  onLegStrikeDrag?: (legId: string, newStrike: number) => void;
  onAddLegAtStrike?: (
    strike: number,
    type: 'call' | 'put',
    direction: 'buy' | 'sell',
    quantity: number,
  ) => void;
  onRemoveLeg?: (legId: string) => void;
}

const PAD = { top: 18, right: 64, bottom: 18, left: 48 };
const BLOCK_W = 64;
const LANE_STEP = BLOCK_W + 8;
const MIN_BLOCK_PX = 6;
/** Lego stud bump size (side view: small rounded rects on the brick's outward edge). */
const STUD_W = 10;
const STUD_H = 5;
/** Vertical room per strike rung; the ladder grows (and scrolls) with rung count. */
const PX_PER_RUNG = 48;

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

export default function PayoffChartV3({
  breakevens,
  spotPrice,
  legs,
  netDebit,
  strikes = [],
  onLegStrikeDrag,
  onAddLegAtStrike,
  onRemoveLeg,
}: PayoffChartV3Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Default to a non-zero size so the chart renders before (and without) a live
  // ResizeObserver — jsdom has no ResizeObserver, and the first paint has no box.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 400 });
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverLegId, setHoverLegId] = useState<string | null>(null);
  const [hoverSpreadKey, setHoverSpreadKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ legId: string; strike: number } | null>(null);
  const [picker, setPicker] = useState<{ y: number; strike: number } | null>(null);
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
  const centerX = plotLeft + plotW / 2;

  const viewLegs = useMemo(
    () => (drag ? legs.map((l) => (l.id === drag.legId ? { ...l, strike: drag.strike } : l)) : legs),
    [legs, drag],
  );
  const viewBreakevens = useMemo(
    () => (drag ? computeMetrics(viewLegs, spotPrice).breakevens : breakevens),
    [drag, viewLegs, spotPrice, breakevens],
  );
  const blocks = useMemo(() => viewLegs.map(legToBlock), [viewLegs]);

  const domain = useMemo(
    () => deriveLadderDomain(blocks, viewBreakevens, spotPrice, strikes),
    [blocks, viewBreakevens, spotPrice, strikes],
  );
  const rungs = domain.rungs;
  const span = domain.priceMax - domain.priceMin || 1;

  // The ladder is taller than the viewport when there are many rungs — the
  // container scrolls. price→y maps over this intrinsic content height, not the
  // viewport, so blocks get real vertical room instead of being force-fit.
  const plotTop = PAD.top;
  const contentH = Math.max(viewportH, rungs.length * PX_PER_RUNG + PAD.top + PAD.bottom);
  const plotBottom = contentH - PAD.bottom;
  const plotH = Math.max(1, plotBottom - plotTop);
  const scale = useMemo(
    () => makePriceScale(domain.priceMin, domain.priceMax, plotTop, plotH),
    [domain, plotTop, plotH],
  );

  // Render units fuse clean verticals into one spread block; lanes pack by each
  // unit's price span (a spread spans both strikes), so an overlapping unit gets
  // its own horizontal offset.
  const units = useMemo(() => buildLadderUnits(viewLegs), [viewLegs]);
  const laneItems = useMemo(
    () =>
      units.map((u) =>
        u.kind === 'spread'
          ? { legId: spreadKey(u.spread), spanLowPrice: u.spread.lowStrike, spanHighPrice: u.spread.highStrike }
          : { legId: u.block.legId, spanLowPrice: u.block.spanLowPrice, spanHighPrice: u.block.spanHighPrice },
      ),
    [units],
  );
  const lanes = useMemo(() => packLanes(laneItems), [laneItems]);
  const laneCount = useMemo(
    () => (lanes.size ? Math.max(...lanes.values()) + 1 : 1),
    [lanes],
  );
  const zones = useMemo(
    () => buildLadderZones(viewLegs, viewBreakevens, spotPrice),
    [viewLegs, viewBreakevens, spotPrice],
  );

  const unitX = (key: string): number => {
    const lane = lanes.get(key) ?? 0;
    const groupW = (laneCount - 1) * LANE_STEP;
    return centerX - groupW / 2 - BLOCK_W / 2 + lane * LANE_STEP;
  };

  const spotY = clampY(spotPrice, scale.y, plotTop, plotBottom);

  // When the ladder overflows the viewport, center it on spot once so the live
  // action is in view; let the user scroll freely after that.
  const didCenterRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (contentH <= viewportH) {
      didCenterRef.current = false;
      return;
    }
    if (didCenterRef.current) return;
    el.scrollTop = Math.max(0, spotY - viewportH / 2);
    didCenterRef.current = true;
  }, [contentH, viewportH, spotY]);

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag && e.buttons === 0) {
      endDrag();
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top + el.scrollTop;
    if (drag) {
      const price = scale.priceAt(Math.max(plotTop, Math.min(plotBottom, y)));
      const snapped = nearestStrike(price, strikes);
      if (snapped != null && snapped !== drag.strike) setDrag({ ...drag, strike: snapped });
      return;
    }
    setHoverY(y >= plotTop && y <= plotBottom ? y : null);
  };
  const handlePointerLeave = () => {
    setHoverY(null);
    setHoverLegId(null);
    setHoverSpreadKey(null);
    setPicker(null);
  };
  const endDrag = () => {
    if (drag) {
      justDraggedRef.current = true;
      if (onLegStrikeDrag) {
        const original = legs.find((l) => l.id === drag.legId);
        if (original && original.strike !== drag.strike) onLegStrikeDrag(drag.legId, drag.strike);
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
    // Native `click` bubbles from leg/spread blocks (whose stopPropagation is on
    // pointerdown, not click); ignore clicks landing on a block so it can't open a
    // picker over it or double-fire with the remove control.
    if ((e.target as Element).closest('[data-leg-id], [data-spread-key]')) return;
    const el = containerRef.current;
    if (!el) return;
    const y = e.clientY - el.getBoundingClientRect().top + el.scrollTop;
    if (y < plotTop || y > plotBottom) return;
    const snapped = nearestStrike(scale.priceAt(y), strikes);
    if (snapped == null) return;
    setPicker({ y, strike: snapped });
  };

  const hoverPrice = hoverY != null ? scale.priceAt(hoverY) : null;
  const hoverReadout = hoverPrice != null ? netPnlReadout(legs, hoverPrice, netDebit) : null;
  const hoveredLeg = hoverLegId != null ? legs.find((l) => l.id === hoverLegId) ?? null : null;
  const hoveredSpread = ((): LadderSpread | null => {
    if (hoverSpreadKey == null) return null;
    for (const u of units) {
      if (u.kind === 'spread' && spreadKey(u.spread) === hoverSpreadKey) return u.spread;
    }
    return null;
  })();

  return (
    <div className={s.container} ref={containerRef}>
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
        </defs>

        {/* Net P&L wash */}
        {zones.map((z, i) => {
          const yHigh = clampY(z.highPrice, scale.y, plotTop, plotBottom);
          const yLow = clampY(z.lowPrice, scale.y, plotTop, plotBottom);
          return (
            <rect
              key={`zone-${i}`}
              className={s.zone}
              x={plotLeft}
              y={yHigh}
              width={plotW}
              height={Math.max(0, yLow - yHigh)}
              fill={z.profit ? 'var(--lego-profit)' : 'var(--lego-loss)'}
              opacity={0.09}
            />
          );
        })}

        {/* Strike rungs — every strike on the ladder */}
        {rungs.map((k) => {
          const y = scale.y(k);
          if (y < plotTop || y > plotBottom) return null;
          return (
            <g key={`rung-${k}`} className={s.rung}>
              <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
              <text x={plotLeft - 4} y={y + 3} fill="var(--text-tertiary)" fontSize="9" textAnchor="end">
                {formatPriceTick(k, span)}
              </text>
            </g>
          );
        })}

        {/* Break-even lines */}
        {viewBreakevens.map((be, i) => {
          const y = scale.y(be);
          if (y < plotTop || y > plotBottom) return null;
          return (
            <g key={`be-${i}`}>
              <line className={s.beLine} x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--lego-be)" strokeWidth="1.3" strokeDasharray="5 3" />
              <text x={plotLeft - 4} y={y + 3} fill="var(--lego-be)" fontSize="9" textAnchor="end">
                {formatPriceTick(be, span)}
              </text>
            </g>
          );
        })}

        {/* Spot line */}
        <line x1={plotLeft} y1={spotY} x2={plotRight} y2={spotY} stroke="var(--accent-primary)" strokeWidth="1.5" />
        <text x={plotRight + 4} y={spotY + 3} fill="var(--accent-primary)" fontSize="9">
          {formatPriceTick(spotPrice, span)}
        </text>

        {/* Blocks — fused spreads + lone legs */}
        {units.map((u) => {
          if (u.kind === 'spread') {
            const sp = u.spread;
            const key = spreadKey(sp);
            const x = unitX(key);
            const spreadActive =
              hoverSpreadKey === key || drag?.legId === sp.longLegId || drag?.legId === sp.shortLegId;
            const cTop = clampY(sp.highStrike, scale.y, plotTop, plotBottom);
            const cBot = clampY(sp.lowStrike, scale.y, plotTop, plotBottom);
            const hue = sp.type === 'call' ? 'var(--lego-call)' : 'var(--lego-put)';
            const legBlock = (block: LadderBlock, legId: string) => (
              <Block
                key={legId}
                block={block}
                x={x}
                yOf={scale.y}
                plotTop={plotTop}
                plotBottom={plotBottom}
                active={spreadActive}
                dragging={drag?.legId === legId}
                isNew={!seenIds.current.has(legId)}
                onDragStart={() => setDrag({ legId, strike: block.strike })}
                onRemove={onRemoveLeg ? () => requestRemove(legId) : undefined}
                exiting={removingId === legId}
                onExitEnd={() => {
                  onRemoveLeg?.(legId);
                  setRemovingId(null);
                }}
              />
            );
            return (
              <g
                key={key}
                data-spread-key={key}
                data-active={spreadActive}
                onPointerEnter={() => setHoverSpreadKey(key)}
                onPointerLeave={() => setHoverSpreadKey(null)}
              >
                {/* defined-risk corridor connecting the two legs */}
                <rect
                  className={s.spreadCorridor}
                  x={x}
                  y={cTop}
                  width={BLOCK_W}
                  height={Math.max(0, cBot - cTop)}
                  rx={6}
                  fill={hue}
                  fillOpacity={0.08}
                  stroke={hue}
                  strokeOpacity={0.4}
                  strokeDasharray="2 3"
                />
                {legBlock(sp.longBlock, sp.longLegId)}
                {legBlock(sp.shortBlock, sp.shortLegId)}
              </g>
            );
          }
          return (
            <Block
              key={u.block.legId}
              block={u.block}
              x={unitX(u.block.legId)}
              yOf={scale.y}
              plotTop={plotTop}
              plotBottom={plotBottom}
              active={hoverLegId === u.block.legId || drag?.legId === u.block.legId}
              dragging={drag?.legId === u.block.legId}
              isNew={!seenIds.current.has(u.block.legId)}
              onEnter={() => setHoverLegId(u.block.legId)}
              onLeave={() => setHoverLegId(null)}
              onDragStart={() => setDrag({ legId: u.block.legId, strike: u.block.strike })}
              onRemove={onRemoveLeg ? () => requestRemove(u.block.legId) : undefined}
              exiting={removingId === u.block.legId}
              onExitEnd={() => {
                onRemoveLeg?.(u.block.legId);
                setRemovingId(null);
              }}
            />
          );
        })}
      </svg>

      {hoverY != null && hoverReadout != null && hoverLegId == null && hoverSpreadKey == null && (
        <div className={s.crosshairChip} data-testid="crosshair-chip" style={{ left: plotLeft + 6, top: hoverY }}>
          @{formatPriceTick(hoverPrice as number, span)} → {fmtUsd(hoverReadout.pnl)}
          {hoverReadout.pct != null ? ` (${fmtPct(hoverReadout.pct, 0)})` : ''}
        </div>
      )}

      {hoveredLeg != null && (
        <div className={s.card} style={{ left: centerX + BLOCK_W, top: scale.y(hoveredLeg.strike) - 40 }}>
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
            <div className={s.card} style={{ left: centerX + BLOCK_W, top: midY - 48 }}>
              <div className={s.cardTitle}>{hoveredSpread.label} spread</div>
              <div>long +{lLeg.quantity} {hoveredSpread.type === 'call' ? 'C' : 'P'} {lLeg.strike}</div>
              <div>short −{sLeg.quantity} {hoveredSpread.type === 'call' ? 'C' : 'P'} {sLeg.strike}</div>
              <div>{m.netDebit < 0 ? 'debit' : 'credit'} {fmtUsd(Math.abs(m.netDebit))}</div>
              <div>
                max {m.maxProfit != null ? fmtUsd(m.maxProfit) : '∞'} / {m.maxLoss != null ? fmtUsd(m.maxLoss) : '∞'}
              </div>
            </div>
          );
        })()}

      {picker && onAddLegAtStrike && (
        <div className={s.picker} style={{ left: centerX - 70, top: picker.y }}>
          {(['buy', 'sell'] as const).flatMap((direction) =>
            (['call', 'put'] as const).map((type) => (
              <button
                key={`${direction}-${type}`}
                type="button"
                data-add={`${direction}-${type}`}
                className={s.pickerBtn}
                onClick={() => {
                  onAddLegAtStrike(picker.strike, type, direction, 1);
                  setPicker(null);
                }}
              >
                {direction === 'buy' ? '+' : '−'}
                {type === 'call' ? 'C' : 'P'} {picker.strike}
              </button>
            )),
          )}
        </div>
      )}

      {legs.length === 0 && <div className={s.empty}>Spot ladder — click a rung to add a leg</div>}
    </div>
  );
}

interface BlockProps {
  block: LadderBlock;
  x: number;
  yOf: (price: number) => number;
  plotTop: number;
  plotBottom: number;
  active: boolean;
  dragging: boolean;
  isNew: boolean;
  exiting: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
  onDragStart: () => void;
  onRemove?: () => void;
  onExitEnd: () => void;
}

function Block({ block, x, yOf, plotTop, plotBottom, active, dragging, isNew, exiting, onEnter, onLeave, onDragStart, onRemove, onExitEnd }: BlockProps) {
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

  const yTop = Math.max(plotTop, Math.min(plotBottom, yOf(block.spanHighPrice)));
  const yBottom = Math.max(plotTop, Math.min(plotBottom, yOf(block.spanLowPrice)));
  const height = Math.max(MIN_BLOCK_PX, yBottom - yTop);
  const beEdgeY = isCall ? yTop : yTop + height; // call B/E is the top edge, put B/E the bottom
  const arrowApexY = isCall
    ? (isLong ? yTop - 12 : yTop + 14)
    : (isLong ? yTop + height + 12 : yTop + height - 14);
  const arrowBaseY = isCall
    ? (isLong ? yTop : yTop + 2)
    : (isLong ? yTop + height : yTop + height - 2);
  const cx = x + BLOCK_W / 2;

  const bodyFill = isLong ? hue : hatch;
  const bodyOpacity = isLong ? 0.32 : 1;
  // Lego studs on the outward (growth) edge: call bricks stud-up, put bricks
  // stud-down. Placed at 30%/70% so the direction arrow rises through the gap.
  const studY = isCall ? yTop - STUD_H : yTop + height;
  const studXs = [x + BLOCK_W * 0.3 - STUD_W / 2, x + BLOCK_W * 0.7 - STUD_W / 2];

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
        onDragStart();
      }}
    >
      <rect
        x={x}
        y={yTop}
        width={BLOCK_W}
        height={height}
        rx={2}
        fill={bodyFill}
        fillOpacity={bodyOpacity}
        stroke={hue}
        strokeWidth={1.5}
        strokeDasharray={isLong ? undefined : '4 3'}
      />
      {/* Lego studs */}
      {studXs.map((sx) => (
        <rect
          key={sx}
          data-stud="true"
          x={sx}
          y={studY}
          width={STUD_W}
          height={STUD_H}
          rx={1.5}
          fill={bodyFill}
          fillOpacity={bodyOpacity}
          stroke={hue}
          strokeWidth={1.2}
        />
      ))}
      {/* Plastic shine under the top edge */}
      {height >= 14 && (
        <rect x={x + 2.5} y={yTop + 2.5} width={BLOCK_W - 5} height={3} rx={1.5} fill="#fff" opacity={0.12} pointerEvents="none" />
      )}
      {/* Short: red cap bar on the break-even edge */}
      {!isLong && (
        <line x1={x} y1={beEdgeY} x2={x + BLOCK_W} y2={beEdgeY} stroke="var(--lego-loss)" strokeWidth="3.5" />
      )}
      {/* Direction arrow */}
      <polygon points={`${cx},${arrowApexY} ${cx - 8},${arrowBaseY} ${cx + 8},${arrowBaseY}`} fill={hue} />
      {/* Label */}
      <text x={cx} y={yTop + height / 2 + 3} fill="var(--text-primary)" fontSize="10" textAnchor="middle">
        {block.label}
      </text>
      {onRemove && (
        <g data-remove-leg={block.legId} style={{ cursor: 'pointer' }} onClick={onRemove}>
          <circle cx={x + BLOCK_W - 4} cy={yTop + 2} r={7} fill="var(--bg-elevated)" stroke="var(--lego-loss)" />
          <text x={x + BLOCK_W - 4} y={yTop + 5} fill="var(--lego-loss)" fontSize="9" textAnchor="middle">×</text>
        </g>
      )}
    </g>
  );
}

