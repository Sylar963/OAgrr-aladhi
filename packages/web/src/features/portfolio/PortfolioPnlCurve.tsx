import { useEffect, useId, useMemo, useState, type PointerEvent } from 'react';

import type { PortfolioPnlCurve as PortfolioPnlCurveData } from '@oggregator/protocol';
import { formatExpiry } from '@lib/format';

import styles from './PortfolioPnlCurve.module.css';

interface Props {
  curve: PortfolioPnlCurveData;
  forwardDays: number;
  mixedExpiries?: boolean;
  onOpenBuilder?: () => void;
  builderDisabledReason?: string | undefined;
}

const WIDTH = 720;
const HEIGHT = 280;
const PADDING = { top: 34, right: 16, bottom: 44, left: 64 };
const TOOLTIP_WIDTH = 150;

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return '$0';
  const sign = rounded > 0 ? '+' : '-';
  return `${sign}$${Math.abs(rounded).toLocaleString()}`;
}

function fmtPct(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toFixed(digits)}%`;
}

function niceStep(span: number, targetCount: number): number {
  const raw = span / Math.max(1, targetCount);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function ticksWithin(min: number, max: number, step: number): number[] {
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : value);
  }
  return ticks;
}

function nearestPoint(
  points: PortfolioPnlCurveData['points'],
  price: number,
): PortfolioPnlCurveData['points'][number] | null {
  let best: PortfolioPnlCurveData['points'][number] | null = null;
  for (const point of points) {
    if (best == null || Math.abs(point.underlyingPriceUsd - price) < Math.abs(best.underlyingPriceUsd - price)) {
      best = point;
    }
  }
  return best;
}

function labelAnchor(x: number): 'start' | 'middle' | 'end' {
  if (x < PADDING.left + 40) return 'start';
  if (x > WIDTH - PADDING.right - 40) return 'end';
  return 'middle';
}

function linePath(
  points: PortfolioPnlCurveData['points'],
  toX: (value: number) => number,
  toY: (value: number) => number,
  pickY: (point: PortfolioPnlCurveData['points'][number]) => number | null,
): string {
  const commands: string[] = [];
  for (const point of points) {
    const y = pickY(point);
    if (y == null || !Number.isFinite(y)) continue;
    commands.push(`${commands.length === 0 ? 'M' : 'L'} ${toX(point.underlyingPriceUsd)} ${toY(y)}`);
  }
  return commands.join(' ');
}

function emptyMessage(status: PortfolioPnlCurveData['status']): string {
  if (status === 'empty') return 'Add positions to see the payoff curve.';
  if (status === 'mixed_underlyings') return 'The payoff curve needs a single underlying book.';
  if (status === 'missing_marks') return 'Live marks are missing for one or more legs, so the curve is unavailable.';
  return 'No P/L curve available.';
}

export default function PortfolioPnlCurve({ curve, forwardDays, mixedExpiries = false, onOpenBuilder, builderDisabledReason }: Props) {
  const [stickyCurve, setStickyCurve] = useState<PortfolioPnlCurveData | null>(null);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  useEffect(() => {
    if (curve.status === 'ok' && curve.points.length > 0) {
      setStickyCurve(curve);
    } else if (curve.status === 'empty' || curve.status === 'mixed_underlyings') {
      setStickyCurve(null);
    } else if (stickyCurve != null && stickyCurve.underlying !== curve.underlying) {
      setStickyCurve(null);
    }
  }, [curve, stickyCurve]);

  const displayCurve =
    curve.status === 'ok' && curve.points.length > 0
      ? curve
      : stickyCurve != null && stickyCurve.underlying === curve.underlying
        ? stickyCurve
        : curve;
  const isStale = displayCurve !== curve;
  const firstUnboundedIndex = displayCurve.riskWindows.findIndex((window) => window.upsideUnbounded);
  const upsideUnboundedAfter =
    firstUnboundedIndex > 0 ? (displayCurve.riskWindows[firstUnboundedIndex]?.from ?? null) : null;
  const lossLabel =
    displayCurve.expiryBasis === 'mixed_expiry'
      ? 'expiry-window low'
      : mixedExpiries
        ? 'same-price scenario low'
        : 'expiry curve low';

  const chart = useMemo(() => {
    if (displayCurve.status !== 'ok' || displayCurve.points.length === 0) return null;
    const xMin = displayCurve.points[0]?.underlyingPriceUsd ?? 0;
    const xMax = displayCurve.points[displayCurve.points.length - 1]?.underlyingPriceUsd ?? 1;
    const values = displayCurve.points.flatMap((point) => [
      point.nowPnlUsd,
      point.expiryPnlUsd,
      point.forwardPnlUsd ?? point.nowPnlUsd,
      0,
    ]);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const yPadding = Math.max(25, (maxValue - minValue) * 0.06);
    const yStep = niceStep(maxValue - minValue + yPadding * 2, 4);
    const yMin = Math.floor((minValue - yPadding) / yStep) * yStep;
    const yMax = Math.ceil((maxValue + yPadding) / yStep) * yStep;
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;

    const toX = (value: number) => PADDING.left + ((value - xMin) / xSpan) * innerW;
    const toY = (value: number) => PADDING.top + (1 - (value - yMin) / ySpan) * innerH;
    const expiryPath = linePath(displayCurve.points, toX, toY, (point) => point.expiryPnlUsd);
    const zeroY = toY(0);

    return {
      toX,
      toY,
      fromX: (svgX: number) => xMin + ((svgX - PADDING.left) / innerW) * xSpan,
      zeroY,
      xTicks: ticksWithin(xMin, xMax, niceStep(xSpan, 6)),
      yTicks: ticksWithin(yMin, yMax, yStep),
      nowPath: linePath(displayCurve.points, toX, toY, (point) => point.nowPnlUsd),
      expiryPath,
      expiryAreaPath: `${expiryPath} L ${toX(xMax)} ${zeroY} L ${toX(xMin)} ${zeroY} Z`,
      forwardPath:
        forwardDays > 0
          ? linePath(displayCurve.points, toX, toY, (point) => point.forwardPnlUsd)
          : '',
    };
  }, [displayCurve, forwardDays]);

  const spot = displayCurve.currentSpotUsd;
  const hovered = chart != null && hoverPrice != null ? nearestPoint(displayCurve.points, hoverPrice) : null;

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (chart == null) return;
    const matrix = event.currentTarget.getScreenCTM?.();
    if (matrix == null) return;
    const inverse = matrix.inverse();
    const svgX = inverse.a * event.clientX + inverse.c * event.clientY + inverse.e;
    if (svgX < PADDING.left || svgX > WIDTH - PADDING.right) {
      setHoverPrice(null);
      return;
    }
    setHoverPrice(chart.fromX(svgX));
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.title}>Portfolio P&amp;L curve</span>
          <span className={styles.subtitle}>x-axis: underlying price • y-axis: portfolio P&amp;L</span>
        </div>
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={styles.nowSwatch} />Now</span>
          {forwardDays > 0 && <span className={styles.legendItem}><span className={styles.forwardSwatch} />T+{forwardDays}d</span>}
          <span className={styles.legendItem}><span className={styles.expirySwatch} />Expiry</span>
        </div>
      </div>

      {onOpenBuilder && (
        <div className={styles.builderRow}>
          <button
            type="button"
            className={styles.builderButton}
            onClick={onOpenBuilder}
            disabled={builderDisabledReason != null}
            aria-describedby="portfolio-builder-hint"
          >
            Open in Builder V2 →
          </button>
          <span id="portfolio-builder-hint" className={styles.subtitle}>
            {builderDisabledReason ?? 'Explore price paths using your entry prices. Replaces current Builder legs; excludes realized P&L and fees.'}
          </span>
        </div>
      )}

      <div className={styles.metaRow}>
        <span className={styles.metricPill}>underlying {displayCurve.underlying ?? '—'}</span>
        <span className={styles.metricPill}>spot {fmtPrice(displayCurve.currentSpotUsd)}</span>
        <span className={styles.metricPill}>
          BE {displayCurve.breakEvenPricesUsd.length === 0 ? '—' : displayCurve.breakEvenPricesUsd.map((value) => fmtPrice(value)).join(' / ')}
        </span>
        {displayCurve.maxProfitUsd != null && <span className={styles.metricPill}>max gain {fmtUsd(displayCurve.maxProfitUsd)}</span>}
        {upsideUnboundedAfter != null ? (
          <span className={styles.metricPill}>Upside unbounded after {formatExpiry(upsideUnboundedAfter)}</span>
        ) : (
          displayCurve.maxLossUsd != null && <span className={styles.metricPill}>{lossLabel} {fmtUsd(displayCurve.maxLossUsd)}</span>
        )}
        {isStale && <span className={styles.stalePill}>stale · waiting for live marks</span>}
      </div>

      <div className={styles.chartWrap}>
        {mixedExpiries && <p className={styles.subtitle}>Multiple expiries: the expiry curve assumes the same settlement price at every date. Its low point is not a portfolio-wide maximum-loss or margin guarantee. Review each expiry separately.</p>}
        {chart == null ? (
          <div className={styles.empty}>{emptyMessage(curve.status)}</div>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className={`${styles.svg} ${isStale ? styles.svgStale : ''}`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverPrice(null)}
          >
            <defs>
              <clipPath id={`${clipId}-gain`}>
                <rect x={0} y={0} width={WIDTH} height={chart.zeroY} />
              </clipPath>
              <clipPath id={`${clipId}-loss`}>
                <rect x={0} y={chart.zeroY} width={WIDTH} height={HEIGHT - chart.zeroY} />
              </clipPath>
            </defs>
            {chart.yTicks.map((value) => {
              const y = chart.toY(value);
              return (
                <g key={`y-${value}`}>
                  <line
                    x1={PADDING.left}
                    x2={WIDTH - PADDING.right}
                    y1={y}
                    y2={y}
                    stroke="#1a1f2b"
                    strokeWidth={1}
                  />
                  <text x={PADDING.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#7c8798">
                    {fmtUsd(value)}
                  </text>
                </g>
              );
            })}
            {chart.xTicks.map((value) => {
              const x = chart.toX(value);
              return (
                <g key={`x-${value}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PADDING.top}
                    y2={HEIGHT - PADDING.bottom}
                    stroke="#10151e"
                    strokeWidth={1}
                  />
                  <text x={x} y={HEIGHT - PADDING.bottom + 16} textAnchor="middle" fontSize={10} fill="#7c8798">
                    {fmtPrice(value)}
                  </text>
                  {spot != null && (
                    <text x={x} y={HEIGHT - PADDING.bottom + 30} textAnchor="middle" fontSize={9} fill="#4b5563">
                      {fmtPct((value / spot - 1) * 100, 0)}
                    </text>
                  )}
                </g>
              );
            })}
            <path d={chart.expiryAreaPath} fill="rgba(74, 222, 128, 0.12)" clipPath={`url(#${clipId}-gain)`} />
            <path d={chart.expiryAreaPath} fill="rgba(248, 113, 113, 0.14)" clipPath={`url(#${clipId}-loss)`} />
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={chart.zeroY}
              y2={chart.zeroY}
              stroke="#475569"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {displayCurve.breakEvenPricesUsd.map((value) => {
              const x = chart.toX(value);
              return (
                <g key={`be-${value}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PADDING.top}
                    y2={HEIGHT - PADDING.bottom}
                    stroke="#fbbf24"
                    strokeWidth={1}
                    strokeDasharray="3 5"
                    opacity={0.95}
                  />
                  <text x={x} y={PADDING.top - 5} textAnchor={labelAnchor(x)} fontSize={9} fill="#fbbf24">
                    BE {fmtPrice(value)}
                  </text>
                </g>
              );
            })}
            {spot != null && (
              <g>
                <line
                  x1={chart.toX(spot)}
                  x2={chart.toX(spot)}
                  y1={PADDING.top}
                  y2={HEIGHT - PADDING.bottom}
                  stroke="#f8fafc"
                  strokeWidth={1}
                  strokeDasharray="6 4"
                />
                <text
                  x={chart.toX(spot)}
                  y={PADDING.top - 19}
                  textAnchor={labelAnchor(chart.toX(spot))}
                  fontSize={9}
                  fill="#f8fafc"
                >
                  spot {fmtPrice(spot)}
                </text>
              </g>
            )}
            {chart.forwardPath && (
              <path
                d={chart.forwardPath}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2}
                strokeDasharray="8 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <path
              d={chart.nowPath}
              fill="none"
              stroke="#a78bfa"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={chart.expiryPath}
              fill="none"
              stroke="#4ade80"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#${clipId}-gain)`}
            />
            <path
              d={chart.expiryPath}
              fill="none"
              stroke="#f87171"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              clipPath={`url(#${clipId}-loss)`}
            />
            {hovered != null && (
              <HoverReadout
                point={hovered}
                spot={spot}
                forwardDays={forwardDays}
                toX={chart.toX}
                toY={chart.toY}
              />
            )}
          </svg>
        )}
      </div>

      <div className={styles.hint}>
        Hover to read P&amp;L at any price. Break-even markers are based on the expiry curve; shading shows expiry gain and loss.
      </div>
    </div>
  );
}

interface HoverReadoutProps {
  point: PortfolioPnlCurveData['points'][number];
  spot: number | null;
  forwardDays: number;
  toX: (value: number) => number;
  toY: (value: number) => number;
}

function HoverReadout({ point, spot, forwardDays, toX, toY }: HoverReadoutProps) {
  const x = toX(point.underlyingPriceUsd);
  const rows: Array<{ label: string; value: number; color: string }> = [
    { label: 'Now', value: point.nowPnlUsd, color: '#a78bfa' },
  ];
  if (forwardDays > 0 && point.forwardPnlUsd != null) {
    rows.push({ label: `T+${forwardDays}d`, value: point.forwardPnlUsd, color: '#38bdf8' });
  }
  rows.push({ label: 'Expiry', value: point.expiryPnlUsd, color: point.expiryPnlUsd < 0 ? '#f87171' : '#4ade80' });

  const boxHeight = 24 + rows.length * 14;
  const boxX = x + 10 + TOOLTIP_WIDTH > WIDTH - PADDING.right ? x - 10 - TOOLTIP_WIDTH : x + 10;
  const boxY = PADDING.top + 4;

  return (
    <g pointerEvents="none" data-testid="pnl-hover">
      <line x1={x} x2={x} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} stroke="#94a3b8" strokeWidth={1} opacity={0.6} />
      {rows.map((row) => (
        <circle key={row.label} cx={x} cy={toY(row.value)} r={3.5} fill={row.color} stroke="#0b0f17" strokeWidth={1.5} />
      ))}
      <rect
        x={boxX}
        y={boxY}
        width={TOOLTIP_WIDTH}
        height={boxHeight}
        rx={4}
        fill="rgba(11, 15, 23, 0.94)"
        stroke="#243041"
      />
      <text x={boxX + 8} y={boxY + 15} fontSize={10} fill="#f8fafc">
        {fmtPrice(point.underlyingPriceUsd)}
      </text>
      {spot != null && (
        <text x={boxX + TOOLTIP_WIDTH - 8} y={boxY + 15} fontSize={10} fill="#94a3b8" textAnchor="end">
          {fmtPct((point.underlyingPriceUsd / spot - 1) * 100, 1)}
        </text>
      )}
      {rows.map((row, index) => (
        <g key={row.label}>
          <text x={boxX + 8} y={boxY + 31 + index * 14} fontSize={10} fill={row.color}>
            {row.label}
          </text>
          <text x={boxX + TOOLTIP_WIDTH - 8} y={boxY + 31 + index * 14} fontSize={10} fill="#e2e8f0" textAnchor="end">
            {fmtUsd(row.value)}
          </text>
        </g>
      ))}
    </g>
  );
}
