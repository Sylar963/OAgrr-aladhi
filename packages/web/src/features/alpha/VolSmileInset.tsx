import { memo, useMemo } from 'react';

import type { SmileCurve } from '@lib/analytics/smile';

import styles from './VolSmileInset.module.css';

interface Props {
  smile: SmileCurve | null;
  shortStrike: number | null;
  longStrike: number | null;
}

const W = 520;
const H = 180;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;

function VolSmileInset({ smile, shortStrike, longStrike }: Props) {
  const layout = useMemo(() => {
    if (!smile || smile.points.length === 0) return null;
    const pts = smile.points.filter((p) => p.blendedIv != null);
    if (pts.length === 0) return null;

    const xs = pts.map((p) => p.strike);
    const ys = pts.map((p) => p.blendedIv!);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const yPad = (yMax - yMin) * 0.1 || 0.01;

    const sx = (x: number) =>
      PAD_L + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * (W - PAD_L - PAD_R);
    const sy = (y: number) =>
      H - PAD_B - ((y - (yMin - yPad)) / Math.max(1e-9, yMax - yMin + 2 * yPad)) * (H - PAD_T - PAD_B);

    const path = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.strike).toFixed(1)} ${sy(p.blendedIv!).toFixed(1)}`)
      .join(' ');

    return {
      path,
      pts,
      sx,
      sy,
      xMin,
      xMax,
      yMin: yMin - yPad,
      yMax: yMax + yPad,
    };
  }, [smile]);

  if (!layout) {
    return (
      <div className={styles.wrap}>
        <div className={styles.title}>Vol smile</div>
        <div className={styles.empty}>Waiting for chain data…</div>
      </div>
    );
  }

  const shortDot = findPoint(layout.pts, shortStrike);
  const longDot = findPoint(layout.pts, longStrike);

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>Vol smile · OTM IV blend</div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label="Volatility smile">
        {/* Y-axis grid */}
        <line
          x1={PAD_L}
          y1={H - PAD_B}
          x2={W - PAD_R}
          y2={H - PAD_B}
          stroke="var(--border-subtle)"
          strokeWidth="1"
        />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--border-subtle)" strokeWidth="1" />

        {/* Axis labels */}
        <text x={PAD_L - 4} y={layout.sy(layout.yMax)} textAnchor="end" className={styles.axisLabel}>
          {(layout.yMax * 100).toFixed(0)}%
        </text>
        <text
          x={PAD_L - 4}
          y={layout.sy(layout.yMin) + 4}
          textAnchor="end"
          className={styles.axisLabel}
        >
          {(layout.yMin * 100).toFixed(0)}%
        </text>
        <text x={PAD_L} y={H - 6} className={styles.axisLabel}>
          {layout.xMin.toLocaleString()}
        </text>
        <text x={W - PAD_R} y={H - 6} textAnchor="end" className={styles.axisLabel}>
          {layout.xMax.toLocaleString()}
        </text>

        {/* Smile curve */}
        <path d={layout.path} fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" />

        {/* Faint marker at spot */}
        {smile && (
          <line
            x1={layout.sx(smile.spot)}
            y1={PAD_T}
            x2={layout.sx(smile.spot)}
            y2={H - PAD_B}
            stroke="var(--text-dim)"
            strokeDasharray="3 3"
            opacity="0.35"
          />
        )}

        {/* Short strike dot (green) */}
        {shortDot && (
          <StrikeMarker
            x={layout.sx(shortDot.strike)}
            y={layout.sy(shortDot.blendedIv!)}
            label={`S ${shortDot.strike.toLocaleString()} · ${(shortDot.blendedIv! * 100).toFixed(1)}%`}
            color="var(--color-profit)"
          />
        )}
        {/* Long strike dot (red) */}
        {longDot && (
          <StrikeMarker
            x={layout.sx(longDot.strike)}
            y={layout.sy(longDot.blendedIv!)}
            label={`L ${longDot.strike.toLocaleString()} · ${(longDot.blendedIv! * 100).toFixed(1)}%`}
            color="var(--color-loss)"
          />
        )}
      </svg>
    </div>
  );
}

function StrikeMarker({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <>
      <circle cx={x} cy={y} r="6" fill={color} stroke="var(--bg-base)" strokeWidth="2" />
      <text x={x + 10} y={y - 8} className={styles.strikeLabel} fill={color}>
        {label}
      </text>
    </>
  );
}

function findPoint(pts: { strike: number; blendedIv: number | null }[], strike: number | null) {
  if (strike == null) return null;
  return pts.find((p) => p.strike === strike && p.blendedIv != null) ?? null;
}

export default memo(VolSmileInset);
