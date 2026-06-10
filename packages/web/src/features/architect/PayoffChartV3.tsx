import { useEffect, useMemo, useRef, useState } from 'react';

import type { Leg, PayoffPoint } from './payoff';
import {
  buildLadderZones,
  derivePriceDomain,
  formatPriceTick,
  legToBlock,
  makePriceScale,
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

export default function PayoffChartV3({
  points,
  breakevens,
  spotPrice,
  legs,
  netDebit: _netDebit,
  strikes: _strikes = [],
  onLegStrikeDrag: _onLegStrikeDrag,
  onAddLegAtStrike: _onAddLegAtStrike,
  onRemoveLeg: _onRemoveLeg,
}: PayoffChartV3Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Default to a non-zero size so the chart renders before (and without) a live
  // ResizeObserver — jsdom has no ResizeObserver, and the first paint has no box.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 400 });

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

  const blocks = useMemo(() => legs.map(legToBlock), [legs]);
  const lanes = useMemo(() => packLanes(blocks), [blocks]);
  const laneCount = useMemo(
    () => (lanes.size ? Math.max(...lanes.values()) + 1 : 1),
    [lanes],
  );
  const zones = useMemo(
    () => buildLadderZones(legs, breakevens, spotPrice),
    [legs, breakevens, spotPrice],
  );

  const blockX = (legId: string): number => {
    const lane = lanes.get(legId) ?? 0;
    const groupW = (laneCount - 1) * LANE_STEP;
    return centerX - groupW / 2 - BLOCK_W / 2 + lane * LANE_STEP;
  };

  const spotY = clampY(spotPrice, scale.y, plotTop, plotBottom);

  return (
    <div className={s.container} ref={containerRef}>
      <svg className={s.svg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
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
          />
        ))}
      </svg>

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
}

function Block({ block, x, yOf, plotTop, plotBottom }: BlockProps) {
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
    <g className={s.block} data-leg-id={block.legId} data-active="false">
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
    </g>
  );
}
