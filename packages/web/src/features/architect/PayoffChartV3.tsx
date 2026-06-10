import { useEffect, useMemo, useRef, useState } from 'react';

import { fmtIv, fmtPct, fmtUsd } from '@lib/format';
import type { Leg, PayoffPoint } from './payoff';
import {
  buildLadderZones,
  derivePriceDomain,
  formatPriceTick,
  legToBlock,
  makePriceScale,
  netPnlReadout,
  packLanes,
  type LadderBlock,
} from './ladder-geometry';
import s from './PayoffChartV3.module.css';

interface PayoffChartV3Props {
  points: PayoffPoint[];
  breakevens: number[];
  spotPrice: number;
  legs: Leg[];
  maxProfit: number | null;
  maxLoss: number | null;
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
  points,
  breakevens,
  spotPrice,
  legs,
  netDebit,
  strikes = [],
  onLegStrikeDrag,
  onAddLegAtStrike: _onAddLegAtStrike,
  onRemoveLeg,
}: PayoffChartV3Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Default to a non-zero size so the chart renders before (and without) a live
  // ResizeObserver — jsdom has no ResizeObserver, and the first paint has no box.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 400 });
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverLegId, setHoverLegId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ legId: string; strike: number } | null>(null);

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

  const { w, h } = size;
  const plotTop = PAD.top;
  const plotBottom = h - PAD.bottom;
  const plotH = Math.max(1, plotBottom - plotTop);
  const plotLeft = PAD.left;
  const plotRight = w - PAD.right;
  const plotW = Math.max(1, plotRight - plotLeft);
  const centerX = plotLeft + plotW / 2;

  const domain = useMemo(() => derivePriceDomain(points, spotPrice), [points, spotPrice]);
  const scale = useMemo(
    () => makePriceScale(domain.priceMin, domain.priceMax, plotTop, plotH),
    [domain, plotTop, plotH],
  );
  const span = domain.priceMax - domain.priceMin || 1;

  const viewLegs = useMemo(
    () => (drag ? legs.map((l) => (l.id === drag.legId ? { ...l, strike: drag.strike } : l)) : legs),
    [legs, drag],
  );

  const blocks = useMemo(() => viewLegs.map(legToBlock), [viewLegs]);
  const lanes = useMemo(() => packLanes(blocks), [blocks]);
  const laneCount = useMemo(
    () => (lanes.size ? Math.max(...lanes.values()) + 1 : 1),
    [lanes],
  );
  const zones = useMemo(
    () => buildLadderZones(viewLegs, breakevens, spotPrice),
    [viewLegs, breakevens, spotPrice],
  );

  const blockX = (legId: string): number => {
    const lane = lanes.get(legId) ?? 0;
    const groupW = (laneCount - 1) * LANE_STEP;
    return centerX - groupW / 2 - BLOCK_W / 2 + lane * LANE_STEP;
  };

  const spotY = clampY(spotPrice, scale.y, plotTop, plotBottom);

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
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
  };
  const endDrag = () => {
    if (drag && onLegStrikeDrag) {
      const original = legs.find((l) => l.id === drag.legId);
      if (original && original.strike !== drag.strike) onLegStrikeDrag(drag.legId, drag.strike);
    }
    setDrag(null);
  };

  const hoverPrice = hoverY != null ? scale.priceAt(hoverY) : null;
  const hoverReadout = hoverPrice != null ? netPnlReadout(legs, hoverPrice, netDebit) : null;
  const hoveredLeg = hoverLegId != null ? legs.find((l) => l.id === hoverLegId) ?? null : null;

  return (
    <div className={s.container} ref={containerRef}>
      <svg
        className={s.svg}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
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
              x={plotLeft}
              y={yHigh}
              width={plotW}
              height={Math.max(0, yLow - yHigh)}
              fill={z.profit ? 'var(--lego-profit)' : 'var(--lego-loss)'}
              opacity={0.09}
            />
          );
        })}

        {/* Break-even lines */}
        {breakevens.map((be, i) => {
          const y = scale.y(be);
          if (y < plotTop || y > plotBottom) return null;
          return (
            <g key={`be-${i}`}>
              <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--lego-be)" strokeWidth="1.3" strokeDasharray="5 3" />
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

        {/* Blocks */}
        {blocks.map((b) => (
          <Block
            key={b.legId}
            block={b}
            x={blockX(b.legId)}
            yOf={scale.y}
            plotTop={plotTop}
            plotBottom={plotBottom}
            active={hoverLegId === b.legId || drag?.legId === b.legId}
            isNew={!seenIds.current.has(b.legId)}
            onEnter={() => setHoverLegId(b.legId)}
            onLeave={() => setHoverLegId(null)}
            onDragStart={() => setDrag({ legId: b.legId, strike: b.strike })}
            onRemove={onRemoveLeg ? () => onRemoveLeg(b.legId) : undefined}
          />
        ))}
      </svg>

      {hoverY != null && hoverReadout != null && hoverLegId == null && (
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
          <div>Δ {hoveredLeg.delta ?? '–'} · Θ {hoveredLeg.theta ?? '–'}</div>
          <div>P/L @spot {fmtUsd(netPnlReadout([hoveredLeg], spotPrice, hoveredLeg.entryPrice).pnl)}</div>
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
  isNew: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onDragStart: () => void;
  onRemove?: () => void;
}

function Block({ block, x, yOf, plotTop, plotBottom, active, isNew, onEnter, onLeave, onDragStart, onRemove }: BlockProps) {
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
  const arrowBaseY = isCall ? (isLong ? yTop : yTop + 14) : (isLong ? yTop + height : yTop + height - 14);
  const cx = x + BLOCK_W / 2;

  return (
    <g
      className={`${s.block} ${isNew ? s.blockEnter : ''}`}
      data-leg-id={block.legId}
      data-active={active}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onDragStart}
    >
      <rect
        x={x}
        y={yTop}
        width={BLOCK_W}
        height={height}
        rx={6}
        fill={isLong ? hue : hatch}
        fillOpacity={isLong ? 0.32 : 1}
        stroke={hue}
        strokeWidth={1.5}
        strokeDasharray={isLong ? undefined : '4 3'}
      />
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
