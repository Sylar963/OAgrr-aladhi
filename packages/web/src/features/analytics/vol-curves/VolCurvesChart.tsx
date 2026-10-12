import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { fmtIv, fmtUsdCompact } from '@lib/format';
import { venueColor } from '@lib/colors';
import { VENUES } from '@lib/venue-meta';
import {
  DELTA_TICKS,
  computeYDomain,
  formatDeltaLabel,
  formatStrikeTick,
  nearestPoint,
  niceTicks,
  pointX,
  withAlpha,
  type SmileCurve,
  type SmilePoint,
  type XAxisMode,
} from './model';
import styles from './VolCurves.module.css';

const MARGIN = { top: 10, right: 48, bottom: 24, left: 8 };
const ZOOM_STEP = 1.15;
const BID_COLOR = 'var(--color-profit)';
const ASK_COLOR = 'var(--color-loss)';
const CROSSED_COLOR = 'var(--color-warning)';

interface VolCurvesChartProps {
  curves: SmileCurve[];
  focused: SmileCurve | null;
  mode: XAxisMode;
  xDomain: [number, number];
  xBounds: [number, number];
  onXDomainChange: (domain: [number, number] | null) => void;
  showVenues: boolean;
  indexSpot: number | null;
}

interface HoverTarget {
  curve: SmileCurve;
  point: SmilePoint;
}

function linePath(
  points: readonly SmilePoint[],
  mode: XAxisMode,
  sx: (v: number) => number,
  sy: (v: number) => number,
): string {
  const coords: Array<[number, number]> = [];
  for (const p of points) {
    const x = pointX(p, mode);
    if (x == null || p.markIv == null) continue;
    coords.push([sx(x), sy(p.markIv)]);
  }
  coords.sort((a, b) => a[0] - b[0]);
  return coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
}

function areaPath(
  points: readonly SmilePoint[],
  mode: XAxisMode,
  sx: (v: number) => number,
  sy: (v: number) => number,
  baseline: number,
): string {
  const line = linePath(points, mode, sx, sy);
  const xs = points
    .filter((p) => p.markIv != null)
    .map((p) => pointX(p, mode))
    .filter((v): v is number => v != null);
  if (!line || xs.length === 0) return '';
  return `${line}V${baseline}H${sx(Math.min(...xs)).toFixed(1)}Z`;
}

function findHover(
  dataX: number | null,
  focused: SmileCurve | null,
  curves: readonly SmileCurve[],
  mode: XAxisMode,
): HoverTarget | null {
  if (dataX == null) return null;
  const pool = focused != null ? [focused] : curves;
  let best: HoverTarget | null = null;
  let bestDist = Infinity;
  for (const curve of pool) {
    const p = nearestPoint(curve.points, mode, dataX);
    const px = p != null ? pointX(p, mode) : null;
    if (p == null || px == null) continue;
    const d = Math.abs(px - dataX);
    if (d < bestDist) {
      bestDist = d;
      best = { curve, point: p };
    }
  }
  return best;
}

function clampDomain(
  lo: number,
  hi: number,
  bounds: readonly [number, number],
): [number, number] {
  const fullSpan = bounds[1] - bounds[0];
  const span = Math.min(Math.max(hi - lo, fullSpan * 0.02), fullSpan);
  let nextLo = lo;
  if (nextLo < bounds[0]) nextLo = bounds[0];
  if (nextLo + span > bounds[1]) nextLo = bounds[1] - span;
  return [nextLo, nextLo + span];
}

export default function VolCurvesChart({
  curves,
  focused,
  mode,
  xDomain,
  xBounds,
  onXDomainChange,
  showVenues,
  indexSpot,
}: VolCurvesChartProps) {
  const clipId = useId();
  const gradId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cursorX, setCursorX] = useState<number | null>(null);
  const dragRef = useRef<{ startPx: number; domain: [number, number] } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(0, size.width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(0, size.height - MARGIN.top - MARGIN.bottom);

  const yDomain = useMemo(
    () => computeYDomain(curves, focused, mode, xDomain) ?? ([0, 1] as [number, number]),
    [curves, focused, mode, xDomain],
  );

  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const sx = (v: number) => MARGIN.left + ((v - x0) / (x1 - x0)) * plotW;
  const sy = (v: number) => MARGIN.top + (1 - (v - y0) / (y1 - y0)) * plotH;
  const invX = (px: number) => x0 + ((px - MARGIN.left) / plotW) * (x1 - x0);

  // Wheel must be a non-passive native listener so preventDefault stops page scroll.
  const zoomRef = useRef({ xDomain, xBounds, plotW, onXDomainChange });
  zoomRef.current = { xDomain, xBounds, plotW, onXDomainChange };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { xDomain: d, xBounds: b, plotW: w, onXDomainChange: change } = zoomRef.current;
      if (w <= 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - MARGIN.left) / w));
      const anchor = d[0] + frac * (d[1] - d[0]);
      const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const span = (d[1] - d[0]) * factor;
      change(clampDomain(anchor - frac * span, anchor - frac * span + span, b));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const hover = findHover(cursorX != null && plotW > 0 ? invX(cursorX) : null, focused, curves, mode);

  const ready = plotW > 0 && plotH > 0 && x1 > x0 && y1 > y0;

  const xTicks =
    mode === 'strike'
      ? niceTicks(x0, x1, Math.max(2, Math.floor(plotW / 90))).map((v) => ({
          x: v,
          label: formatStrikeTick(v),
        }))
      : DELTA_TICKS.filter((t) => t.x >= x0 && t.x <= x1);
  const yTicks = niceTicks(y0 * 100, y1 * 100, Math.max(2, Math.floor(plotH / 50)));

  const maxOi = focused ? Math.max(1, ...focused.points.map((p) => p.oiUsd)) : 1;
  const inView = (x: number | null): x is number => x != null && x >= x0 && x <= x1;

  const refLine =
    mode === 'strike'
      ? indexSpot != null && indexSpot >= x0 && indexSpot <= x1
        ? { x: indexSpot, label: 'spot' }
        : null
      : 0.5 >= x0 && 0.5 <= x1
        ? { x: 0.5, label: '50Δ' }
        : null;

  const ordered = focused
    ? [...curves.filter((c) => c.expiry !== focused.expiry), focused]
    : curves;

  const hoverPx = hover ? pointX(hover.point, mode) : null;
  const tooltipLeft =
    hoverPx != null ? (sx(hoverPx) > size.width * 0.6 ? undefined : sx(hoverPx) + 14) : undefined;
  const tooltipRight =
    hoverPx != null && sx(hoverPx) > size.width * 0.6 ? size.width - sx(hoverPx) + 14 : undefined;

  return (
    <div
      ref={wrapRef}
      className={styles.chart}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const drag = dragRef.current;
        if (drag && plotW > 0) {
          const shift = ((px - drag.startPx) / plotW) * (drag.domain[1] - drag.domain[0]);
          onXDomainChange(clampDomain(drag.domain[0] - shift, drag.domain[1] - shift, xBounds));
          setCursorX(null);
          return;
        }
        setCursorX(px >= MARGIN.left && px <= MARGIN.left + plotW ? px : null);
      }}
      onPointerLeave={() => setCursorX(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        dragRef.current = { startPx: e.clientX - rect.left, domain: xDomain };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        dragRef.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onDoubleClick={() => onXDomainChange(null)}
    >
      {ready && (
        <svg width={size.width} height={size.height} className={styles.svg}>
          <defs>
            <clipPath id={clipId}>
              <rect x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH} />
            </clipPath>
            {focused && (
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={withAlpha(focused.color, 0.18)} />
                <stop offset="100%" stopColor={withAlpha(focused.color, 0)} />
              </linearGradient>
            )}
          </defs>

          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line
                className={styles.grid}
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={sy(t / 100)}
                y2={sy(t / 100)}
              />
              <text className={styles.axisText} x={MARGIN.left + plotW + 6} y={sy(t / 100)} dy="0.32em">
                {`${t}%`}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={`x${t.x}`}>
              <line
                className={styles.grid}
                x1={sx(t.x)}
                x2={sx(t.x)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotH}
              />
              <text
                className={styles.axisText}
                x={sx(t.x)}
                y={MARGIN.top + plotH + 15}
                textAnchor="middle"
              >
                {t.label}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {refLine && (
              <g>
                <line
                  className={styles.refLine}
                  x1={sx(refLine.x)}
                  x2={sx(refLine.x)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotH}
                />
                <text className={styles.refLabel} x={sx(refLine.x) + 4} y={MARGIN.top + 10}>
                  {refLine.label}
                </text>
              </g>
            )}

            {focused && (
              <path d={areaPath(focused.points, mode, sx, sy, MARGIN.top + plotH)} fill={`url(#${gradId})`} />
            )}

            {ordered.map((curve) => {
              const isFocused = focused?.expiry === curve.expiry;
              const dimmed = focused != null && !isFocused;
              return (
                <path
                  key={curve.expiry}
                  d={linePath(curve.points, mode, sx, sy)}
                  fill="none"
                  stroke={dimmed ? withAlpha(curve.color, 0.28) : curve.color}
                  strokeWidth={isFocused ? 2.25 : dimmed ? 1.25 : 1.75}
                  strokeLinejoin="round"
                />
              );
            })}

            {focused &&
              focused.points.map((p) => {
                const x = pointX(p, mode);
                if (!inView(x)) return null;
                const px = sx(x);
                const weight = 0.3 + 0.7 * Math.sqrt(p.oiUsd / maxOi);
                const bidY = p.bestBid ? sy(p.bestBid.iv) : null;
                const askY = p.bestAsk ? sy(p.bestAsk.iv) : null;
                return (
                  <g key={`ba${p.strike}`} opacity={weight}>
                    {bidY != null && askY != null && (
                      <line
                        x1={px}
                        x2={px}
                        y1={bidY}
                        y2={askY}
                        stroke={p.crossed ? CROSSED_COLOR : 'var(--text-tertiary)'}
                        strokeWidth={p.crossed ? 2 : 1}
                      />
                    )}
                    {bidY != null && (
                      <line x1={px - 3} x2={px + 3} y1={bidY} y2={bidY} stroke={BID_COLOR} strokeWidth={2} />
                    )}
                    {askY != null && (
                      <line x1={px - 3} x2={px + 3} y1={askY} y2={askY} stroke={ASK_COLOR} strokeWidth={2} />
                    )}
                    {p.crossed && bidY != null && askY != null && (
                      <circle
                        cx={px}
                        cy={(bidY + askY) / 2}
                        r={5}
                        fill="none"
                        stroke={CROSSED_COLOR}
                        strokeWidth={1.5}
                      />
                    )}
                  </g>
                );
              })}

            {focused &&
              showVenues &&
              focused.points.flatMap((p) => {
                const x = pointX(p, mode);
                if (!inView(x)) return [];
                return p.venues
                  .filter((v) => v.markIv != null)
                  .map((v) => (
                    <circle
                      key={`v${p.strike}${v.venue}`}
                      cx={sx(x)}
                      cy={sy(v.markIv!)}
                      r={2.5}
                      fill={venueColor(v.venue)}
                      opacity={0.85}
                    />
                  ));
              })}

            {focused &&
              focused.points.map((p) => {
                const x = pointX(p, mode);
                if (!inView(x) || p.markIv == null) return null;
                return (
                  <circle
                    key={`m${p.strike}`}
                    cx={sx(x)}
                    cy={sy(p.markIv)}
                    r={2}
                    fill={focused.color}
                  />
                );
              })}

            {hover && hoverPx != null && (
              <g>
                <line
                  className={styles.crosshair}
                  x1={sx(hoverPx)}
                  x2={sx(hoverPx)}
                  y1={MARGIN.top}
                  y2={MARGIN.top + plotH}
                />
                {hover.point.markIv != null && (
                  <circle
                    cx={sx(hoverPx)}
                    cy={sy(hover.point.markIv)}
                    r={4}
                    fill={hover.curve.color}
                    stroke="var(--bg-surface)"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            )}
          </g>
        </svg>
      )}

      {hover && hoverPx != null && (
        <div
          className={styles.tooltip}
          style={{ left: tooltipLeft, right: tooltipRight, top: MARGIN.top + 4 }}
        >
          <Tooltip target={hover} />
        </div>
      )}
    </div>
  );
}

function Tooltip({ target }: { target: HoverTarget }) {
  const { curve, point } = target;
  const spread =
    point.bestBid != null && point.bestAsk != null ? point.bestAsk.iv - point.bestBid.iv : null;
  const venueLabel = (id: string) => VENUES[id]?.shortLabel ?? id.toUpperCase();
  return (
    <>
      <div className={styles.ttHead}>
        <span style={{ color: curve.color }}>{curve.label}</span>
        <span className={styles.ttDim}>{curve.dte}d</span>
      </div>
      <div className={styles.ttHead}>
        <span>{point.strike.toLocaleString('en-US')}</span>
        <span className={styles.ttDim}>
          {point.side === 'put' ? 'P' : 'C'}
          {point.x != null ? ` · ${formatDeltaLabel(point.x)}` : ''}
        </span>
      </div>
      <dl className={styles.ttGrid}>
        <dt>Mark</dt>
        <dd>{fmtIv(point.markIv)}</dd>
        <dt style={{ color: BID_COLOR }}>Best bid</dt>
        <dd>
          {fmtIv(point.bestBid?.iv)}
          {point.bestBid && <span className={styles.ttDim}> {venueLabel(point.bestBid.venue)}</span>}
        </dd>
        <dt style={{ color: ASK_COLOR }}>Best ask</dt>
        <dd>
          {fmtIv(point.bestAsk?.iv)}
          {point.bestAsk && <span className={styles.ttDim}> {venueLabel(point.bestAsk.venue)}</span>}
        </dd>
        <dt>Spread</dt>
        <dd>{spread != null ? `${(spread * 100).toFixed(1)} vol` : '–'}</dd>
        <dt>OI</dt>
        <dd>{point.oiUsd > 0 ? fmtUsdCompact(point.oiUsd) : '–'}</dd>
      </dl>
      {point.crossed && (
        <div className={styles.ttCrossed}>Crossed across venues (before fees)</div>
      )}
      {point.venues.length > 0 && (
        <table className={styles.ttVenues}>
          <thead>
            <tr>
              <th />
              <th>bid</th>
              <th>mark</th>
              <th>ask</th>
            </tr>
          </thead>
          <tbody>
            {point.venues.map((v) => (
              <tr key={v.venue}>
                <td>
                  <span className={styles.ttSwatch} style={{ background: venueColor(v.venue) }} />
                  {venueLabel(v.venue)}
                </td>
                <td>{v.bidIv != null ? (v.bidIv * 100).toFixed(1) : '–'}</td>
                <td>{v.markIv != null ? (v.markIv * 100).toFixed(1) : '–'}</td>
                <td>{v.askIv != null ? (v.askIv * 100).toFixed(1) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
