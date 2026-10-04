import styles from './SkewSmileChart.module.css';
import type { SmilePoint } from './skew-history-utils';
import { useMeasuredWidth } from './use-measured-width';

interface Props {
  now: SmilePoint[];
  reference: SmilePoint[] | null;
  referenceLabel: string;
}

// Fallback viewBox width used until the container is measured (and in jsdom,
// where layout/ResizeObserver are unavailable). The chart drives its real
// viewBox width from the measured container so it fills the panel exactly —
// the height stays fixed so the chart fits its slot in the (fixed-height)
// surface panel without distorting the in-SVG axis text.
const W_FALLBACK = 480;
const H = 140;
const PAD_L = 34;
const PAD_R = 12;
const PAD_T = 18;
const PAD_B = 26;

export default function SkewSmileChart({ now, reference, referenceLabel }: Props) {
  const [wrapRef, W] = useMeasuredWidth<HTMLDivElement>(W_FALLBACK);

  if (now.length === 0) {
    return (
      <div className={styles.wrap} ref={wrapRef}>
        <div className={styles.empty}>insufficient data</div>
      </div>
    );
  }

  const all = [...now, ...(reference ?? [])];
  const ivs = all.map((p) => p.iv);
  const ivMin = Math.min(...ivs);
  const ivMax = Math.max(...ivs);
  const ivSpan = ivMax - ivMin || 1;
  const padIv = ivSpan * 0.15;
  const lo = ivMin - padIv;
  const hi = ivMax + padIv;

  // Map the actual delta range to the full plot width so the smile (and its
  // axis labels) span edge-to-edge instead of sitting inset in the middle.
  const xs = now.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;
  const toX = (x: number) => PAD_L + ((x - xMin) / xSpan) * (W - PAD_L - PAD_R);
  const toY = (iv: number) => PAD_T + (1 - (iv - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const line = (pts: SmilePoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.x).toFixed(1)},${toY(p.iv).toFixed(1)}`)
      .join(' ');

  const gridIvs = [hi, (hi + lo) / 2, lo];
  const refByLabel = new Map((reference ?? []).map((p) => [p.label, p.iv]));

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label="volatility smile"
      >
        {gridIvs.map((iv) => (
          <g key={iv.toFixed(2)}>
            <line x1={PAD_L} y1={toY(iv)} x2={W - PAD_R} y2={toY(iv)} stroke="#15191d" />
            <text x="2" y={toY(iv) + 3} fill="#3f484f" fontSize="9" fontFamily="monospace">
              {iv.toFixed(0)}%
            </text>
          </g>
        ))}
        {reference && reference.length > 0 && (
          <path
            d={line(reference)}
            fill="none"
            stroke="#50d2c1"
            strokeWidth="1.3"
            strokeDasharray="4 3"
            opacity="0.4"
          />
        )}
        <path d={line(now)} fill="none" stroke="#50d2c1" strokeWidth="2" />
        {now.map((p, i) => {
          const ref = refByLabel.get(p.label);
          const delta = ref != null ? p.iv - ref : null;
          return (
            <g key={p.label}>
              <circle cx={toX(p.x)} cy={toY(p.iv)} r="3" fill="#50d2c1">
                <title>{`${p.label} ${p.iv.toFixed(1)}%${delta != null ? ` (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} vs ${referenceLabel})` : ''}`}</title>
              </circle>
              <text
                x={toX(p.x)}
                y={toY(p.iv) - 7}
                fill="#c9d1d9"
                fontSize="9"
                fontFamily="monospace"
                textAnchor={i === 0 ? 'start' : i === now.length - 1 ? 'end' : 'middle'}
              >
                {p.iv.toFixed(1)}
                {delta != null && (
                  <tspan fill={delta >= 0 ? '#f59e0b' : '#50d2c1'}>
                    {` ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`}
                  </tspan>
                )}
              </text>
            </g>
          );
        })}
        {now.map((p, i) => (
          <text
            key={`l-${p.label}`}
            x={toX(p.x)}
            y={H - 10}
            fill="#6b7280"
            fontSize="9"
            fontFamily="monospace"
            textAnchor={i === 0 ? 'start' : i === now.length - 1 ? 'end' : 'middle'}
          >
            {p.label}
          </text>
        ))}
      </svg>
      <div className={styles.caption}>
        {reference && reference.length > 0
          ? `solid = now · dashed = ${referenceLabel} · labels = IV and change in vol pts · tilt = RR · lift = Fly`
          : `solid = now · no history for ${referenceLabel}`}
      </div>
    </div>
  );
}
