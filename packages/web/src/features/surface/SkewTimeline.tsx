import { type MouseEvent, type ReactNode, useState } from 'react';

import InfoTip from '@components/ui/InfoTip';

import styles from './SkewTimeline.module.css';
import { buildBands, ordinal, type SkewLinePoint, zoneForPercentile } from './skew-history-utils';
import { useMeasuredWidth } from './use-measured-width';

interface Props {
  label: string;
  title: string;
  tip: ReactNode;
  color: string;
  /** Metric over the lookback, in vol points; `time` is epoch seconds. */
  points: SkewLinePoint[];
  percentile: number | null;
  atmText: string;
  /** Value at the VS reference time, in vol points. */
  refValue: number | null;
  refTimeMs: number | null;
  refLabel: string;
  upLabel: string;
  downLabel: string;
  loading?: boolean;
}

const W_FALLBACK = 480;
const H = 72;
const PAD_L = 36;
const PAD_R = 8;
const PAD_T = 6;
const PAD_B = 6;

function fmtVp(v: number, digits = 1): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}vp`;
}

function fmtTime(sec: number): string {
  const d = new Date(sec * 1000);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SkewTimeline({
  label,
  title,
  tip,
  color,
  points,
  percentile,
  atmText,
  refValue,
  refTimeMs,
  refLabel,
  upLabel,
  downLabel,
  loading = false,
}: Props) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>(W_FALLBACK);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const header = (
    <span className={styles.name} style={{ color }}>
      {label}
      <InfoTip label={label} title={title} align="start">
        {tip}
      </InfoTip>
    </span>
  );

  if (points.length < 2) {
    return (
      <div className={styles.block} ref={wrapRef}>
        <div className={styles.header}>
          {header}
          <span className={styles.muted}>{loading ? 'loading…' : 'insufficient history'}</span>
        </div>
      </div>
    );
  }

  const W = width;
  const bands = buildBands(points)!;
  const values = points.map((p) => p.value);
  const now = values[values.length - 1]!;
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const vPad = (vMax - vMin || 1) * 0.1;
  const lo = vMin - vPad;
  const hi = vMax + vPad;
  const tMin = points[0]!.time;
  const tMax = points[points.length - 1]!.time;
  const tSpan = tMax - tMin || 1;
  const toX = (t: number) => PAD_L + ((t - tMin) / tSpan) * (W - PAD_L - PAD_R);
  const toY = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.time).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(' ');
  const zeroVisible = lo < 0 && hi > 0;
  const refSec = refTimeMs != null ? refTimeMs / 1000 : null;
  const refInRange = refSec != null && refSec >= tMin && refSec <= tMax;
  const delta = refValue != null ? now - refValue : null;
  const zone = zoneForPercentile(percentile);
  const hover = hoverIdx != null ? points[hoverIdx] : null;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const t = tMin + ((x - PAD_L) / (W - PAD_L - PAD_R)) * tSpan;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i]!.time - t);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  return (
    <div className={styles.block} ref={wrapRef}>
      <div className={styles.header}>
        {header}
        <span className={styles.value} style={{ color }}>
          {fmtVp(now)}
        </span>
        <span
          className={styles.chip}
          data-zone={zone ?? 'normal'}
          title="Share of lookback samples at or below the current value"
        >
          {percentile != null ? `${ordinal(percentile)} pct` : '– pct'}
        </span>
        {delta != null && (
          <span className={styles.sub}>
            Δ {refLabel} {fmtVp(delta)}
          </span>
        )}
        <span className={styles.sub}>{atmText}</span>
        <span className={styles.readout}>
          {hover ? `${fmtTime(hover.time)} · ${fmtVp(hover.value, 2)}` : ''}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`${label} history`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <rect
          x={PAD_L}
          y={toY(bands.p90)}
          width={W - PAD_L - PAD_R}
          height={Math.max(0, toY(bands.p10) - toY(bands.p90))}
          fill={color}
          fillOpacity="0.08"
        />
        <line
          x1={PAD_L}
          x2={W - PAD_R}
          y1={toY(bands.p50)}
          y2={toY(bands.p50)}
          stroke={color}
          strokeOpacity="0.35"
          strokeDasharray="3 3"
        />
        {zeroVisible && (
          <line x1={PAD_L} x2={W - PAD_R} y1={toY(0)} y2={toY(0)} stroke="#2a3138" />
        )}
        <text x="2" y={PAD_T + 7} className={styles.axis}>
          {hi.toFixed(1)}
        </text>
        <text x="2" y={H - PAD_B} className={styles.axis}>
          {lo.toFixed(1)}
        </text>
        <text x={W - PAD_R - 2} y={PAD_T + 7} textAnchor="end" className={styles.semantic}>
          {upLabel} ↑
        </text>
        <text x={W - PAD_R - 2} y={H - PAD_B} textAnchor="end" className={styles.semantic}>
          {downLabel} ↓
        </text>
        {refInRange && (
          <line
            x1={toX(refSec!)}
            x2={toX(refSec!)}
            y1={PAD_T}
            y2={H - PAD_B}
            stroke="#6b7280"
            strokeDasharray="2 3"
          />
        )}
        <path d={path} fill="none" stroke={color} strokeWidth="1.4" />
        <circle cx={toX(tMax)} cy={toY(now)} r="3" fill="#fff" />
        {hover && (
          <>
            <line
              x1={toX(hover.time)}
              x2={toX(hover.time)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="#9ca3af"
              strokeOpacity="0.5"
            />
            <circle cx={toX(hover.time)} cy={toY(hover.value)} r="2.5" fill={color} />
          </>
        )}
      </svg>
    </div>
  );
}
