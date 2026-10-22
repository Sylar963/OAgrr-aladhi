import { type MouseEvent, useState } from 'react';

import { COLORS } from '@lib/colors';
import { useLocale, useT } from '@lib/i18n';

import { skewMessages } from './i18n';
import styles from './SkewRegime.module.css';
import {
  formatRegimeValue,
  type RegimePoint,
  type RegimeSource,
  type RegimeState,
  regimeLabel,
} from './skew-regime';
import { useMeasuredWidth } from './use-measured-width';

export const REGIME_COLORS: Record<RegimeState, string> = {
  'risk-on': COLORS.blue,
  neutral: '#a5c4d4',
  'risk-off': COLORS.red,
};
const WARMUP_COLOR = '#3f484f';
const ZONE_COLOR = '#6b7280';

const W_FALLBACK = 480;
const H = 168;
const PAD_L = 52;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 18;
const X_TICKS = 5;

interface Props {
  points: RegimePoint[];
  source: RegimeSource;
  underlying: string;
}

function fmtTick(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtTime(sec: number): string {
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function linePath(
  points: RegimePoint[],
  pick: (p: RegimePoint) => number | null,
  toX: (t: number) => number,
  toY: (v: number) => number,
): string {
  let d = '';
  let open = false;
  for (const p of points) {
    const v = pick(p);
    if (v == null) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${toX(p.time).toFixed(1)},${toY(v).toFixed(1)}`;
    open = true;
  }
  return d;
}

interface Segment {
  regime: RegimeState | null;
  d: string;
}

/** One path per run of equal regime; each run ends on the next run's first point so the line stays continuous. */
function segments(
  points: RegimePoint[],
  toX: (t: number) => number,
  toY: (v: number) => number,
): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i < points.length && points[i]!.regime === points[start]!.regime) continue;
    const run = points.slice(start, Math.min(i + 1, points.length));
    out.push({
      regime: points[start]!.regime,
      d: run
        .map((p, j) => `${j === 0 ? 'M' : 'L'}${toX(p.time).toFixed(1)},${toY(p.value).toFixed(1)}`)
        .join(''),
    });
    start = i;
  }
  return out;
}

export default function SkewRegimeChart({ points, source, underlying }: Props) {
  const t = useT(skewMessages);
  const locale = useLocale();
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>(W_FALLBACK);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const fmt = (v: number) => formatRegimeValue(v, source, underlying);

  if (points.length < 2) {
    return <div className={styles.chartWrap} ref={wrapRef} style={{ height: H }} />;
  }

  const W = width;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of points) {
    for (const v of [p.value, p.upper, p.lower]) {
      if (v == null) continue;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }
  const vPad = (vMax - vMin || 1) * 0.08;
  const lo = vMin - vPad;
  const hi = vMax + vPad;
  const tMin = points[0]!.time;
  const tMax = points[points.length - 1]!.time;
  const tSpan = tMax - tMin || 1;
  const toX = (t: number) => PAD_L + ((t - tMin) / tSpan) * (W - PAD_L - PAD_R);
  const toY = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const zeroVisible = lo < 0 && hi > 0;
  const last = points[points.length - 1]!;
  const hover = hoverIdx != null ? points[hoverIdx] : null;
  const ticks = Array.from({ length: X_TICKS }, (_, i) => tMin + (tSpan * i) / (X_TICKS - 1));

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const time = tMin + ((x - PAD_L) / (W - PAD_L - PAD_R)) * tSpan;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i]!.time - time);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  return (
    <div className={styles.chartWrap} ref={wrapRef}>
      <div className={styles.readout}>
        {hover
          ? `${fmtTime(hover.time)} · ${fmt(hover.value)}${
              hover.lower != null && hover.upper != null
                ? t('readoutZones', { lower: fmt(hover.lower), upper: fmt(hover.upper) })
                : ''
            } · ${hover.regime ? regimeLabel(hover.regime, locale) : t('warmingUp')}`
          : ''}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={t('regimeAria')}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {zeroVisible && <line x1={PAD_L} x2={W - PAD_R} y1={toY(0)} y2={toY(0)} stroke="#2a3138" />}
        <path
          d={linePath(points, (p) => p.mid, toX, toY)}
          fill="none"
          stroke={ZONE_COLOR}
          strokeOpacity="0.35"
          strokeDasharray="1 4"
        />
        <path
          d={linePath(points, (p) => p.upper, toX, toY)}
          fill="none"
          stroke={ZONE_COLOR}
          strokeDasharray="3 3"
        />
        <path
          d={linePath(points, (p) => p.lower, toX, toY)}
          fill="none"
          stroke={ZONE_COLOR}
          strokeDasharray="3 3"
        />
        {segments(points, toX, toY).map((seg, i) => (
          <path
            key={i}
            d={seg.d}
            fill="none"
            stroke={seg.regime ? REGIME_COLORS[seg.regime] : WARMUP_COLOR}
            strokeWidth={seg.regime === 'neutral' || seg.regime == null ? 1.2 : 1.8}
          />
        ))}
        <text x="2" y={PAD_T + 7} className={styles.axis}>
          {fmt(hi)}
        </text>
        <text x="2" y={H - PAD_B} className={styles.axis}>
          {fmt(lo)}
        </text>
        <text x={W - PAD_R - 2} y={PAD_T + 7} textAnchor="end" className={styles.semantic}>
          {t('callsUp')}
        </text>
        <text x={W - PAD_R - 2} y={H - PAD_B} textAnchor="end" className={styles.semantic}>
          {t('putsDown')}
        </text>
        {ticks.map((tick, i) => (
          <text
            key={tick}
            x={toX(tick)}
            y={H - 4}
            textAnchor={i === 0 ? 'start' : i === X_TICKS - 1 ? 'end' : 'middle'}
            className={styles.axis}
          >
            {fmtTick(tick)}
          </text>
        ))}
        <circle
          cx={toX(last.time)}
          cy={toY(last.value)}
          r="3"
          fill={last.regime ? REGIME_COLORS[last.regime] : '#fff'}
        />
        {hover && (
          <line
            x1={toX(hover.time)}
            x2={toX(hover.time)}
            y1={PAD_T}
            y2={H - PAD_B}
            stroke="#9ca3af"
            strokeOpacity="0.5"
          />
        )}
      </svg>
    </div>
  );
}
