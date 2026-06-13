import styles from './SkewSmileChart.module.css';
import type { SmilePoint } from './skew-history-utils';

interface Props {
  now: SmilePoint[];
  reference: SmilePoint[] | null;
  referenceLabel: string;
}

const W = 480;
const H = 150;
const PAD_L = 34;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;

export default function SkewSmileChart({ now, reference, referenceLabel }: Props) {
  if (now.length === 0) {
    return <div className={styles.empty}>insufficient data</div>;
  }

  const all = [...now, ...(reference ?? [])];
  const ivs = all.map((p) => p.iv);
  const ivMin = Math.min(...ivs);
  const ivMax = Math.max(...ivs);
  const ivSpan = ivMax - ivMin || 1;
  const padIv = ivSpan * 0.15;
  const lo = ivMin - padIv;
  const hi = ivMax + padIv;

  const toX = (x: number) => PAD_L + x * (W - PAD_L - PAD_R);
  const toY = (iv: number) => PAD_T + (1 - (iv - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const line = (pts: SmilePoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.x).toFixed(1)},${toY(p.iv).toFixed(1)}`)
      .join(' ');

  const gridIvs = [hi, (hi + lo) / 2, lo];

  return (
    <div className={styles.wrap}>
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
        {now.map((p) => (
          <circle key={p.label} cx={toX(p.x)} cy={toY(p.iv)} r="3" fill="#50d2c1" />
        ))}
        {now.map((p) => (
          <text
            key={`l-${p.label}`}
            x={toX(p.x)}
            y={H - 10}
            fill="#6b7280"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {p.label}
          </text>
        ))}
      </svg>
      <div className={styles.caption}>
        solid = now · faded = {referenceLabel} · tilt = RR · lift = Fly
      </div>
    </div>
  );
}
