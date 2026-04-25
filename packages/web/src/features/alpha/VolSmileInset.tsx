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
      <div className={styles.title}>
        <span>Vol smile · OTM IV blend</span>
        <span className={styles.stats}>
          {smile?.atmIv != null && (
            <span className={styles.stat}>
              ATM <strong>{(smile.atmIv * 100).toFixed(1)}%</strong>
            </span>
          )}
          {smile?.skew != null && (
            <span className={styles.stat} title="(IV at 0.9·spot − IV at 1.1·spot) / ATM IV. Positive = downside puts richer than upside calls.">
              Skew{' '}
              <strong data-sign={smile.skew >= 0 ? 'pos' : 'neg'}>
                {smile.skew >= 0 ? '+' : ''}
                {smile.skew.toFixed(3)}
              </strong>
            </span>
          )}
        </span>
        <span className={styles.subtitle}>
          per-strike avg markIv across venues — puts below spot, calls above
        </span>
      </div>
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

        {/* Short strike dot (green) — label always anchored above */}
        {shortDot && (
          <StrikeMarker
            x={layout.sx(shortDot.strike)}
            y={layout.sy(shortDot.blendedIv!)}
            label={`S ${shortDot.strike.toLocaleString()} · ${(shortDot.blendedIv! * 100).toFixed(1)}%`}
            color="var(--color-profit)"
            placement="above"
          />
        )}
        {/* Long strike dot (red) — label always anchored below to avoid stacking on the short label */}
        {longDot && (
          <StrikeMarker
            x={layout.sx(longDot.strike)}
            y={layout.sy(longDot.blendedIv!)}
            label={`L ${longDot.strike.toLocaleString()} · ${(longDot.blendedIv! * 100).toFixed(1)}%`}
            color="var(--color-loss)"
            placement="below"
          />
        )}
      </svg>
    </div>
  );
}

function StrikeMarker({
  x,
  y,
  label,
  color,
  placement,
}: {
  x: number;
  y: number;
  label: string;
  color: string;
  placement: 'above' | 'below';
}) {
  // Flip horizontal anchor when the dot is in the right half so the label
  // doesn't get clipped at the chart edge.
  const anchorRight = x > (W + PAD_L - PAD_R) / 2;
  const tx = anchorRight ? x - 10 : x + 10;
  const ty = placement === 'above' ? y - 12 : y + 18;
  return (
    <>
      <circle cx={x} cy={y} r="5" fill={color} stroke="var(--bg-base)" strokeWidth="2" />
      <text
        x={tx}
        y={ty}
        textAnchor={anchorRight ? 'end' : 'start'}
        className={styles.strikeLabel}
        fill={color}
        paintOrder="stroke"
        stroke="var(--bg-elevated)"
        strokeWidth="3"
        strokeLinejoin="round"
      >
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
