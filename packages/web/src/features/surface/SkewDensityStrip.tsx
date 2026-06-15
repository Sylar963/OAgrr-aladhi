import styles from './SkewDensityStrip.module.css';
import type { SkewDistribution, SkewLinePoint } from './skew-history-utils';

interface Props {
  label: string;
  color: string;
  distribution: SkewDistribution | null;
  atmText: string;
  spark: SkewLinePoint[];
}

const W = 320;
const H = 50;

function fmtVp(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}vp`;
}

function fmtSigma(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}σ`;
}

function sparkPath(spark: SkewLinePoint[]): string {
  if (spark.length < 2) return '';
  const xs = spark.map((p) => p.time);
  const ys = spark.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  return spark
    .map((p, i) => {
      const px = ((p.time - xMin) / xSpan) * 64;
      const py = 16 - ((p.value - yMin) / ySpan) * 14;
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');
}

export default function SkewDensityStrip({ label, color, distribution, atmText, spark }: Props) {
  if (!distribution) {
    return (
      <div className={styles.block}>
        <div className={styles.header}>
          <span className={styles.name} style={{ color }}>
            {label}
          </span>
          <span className={styles.muted}>insufficient history</span>
        </div>
      </div>
    );
  }

  const { bins, nowValue, percentile, sigma, zone, mean, stddev, rangeLo, rangeHi } = distribution;
  const span = rangeHi - rangeLo || 1;
  const toX = (v: number) => 10 + ((v - rangeLo) / span) * (W - 20);
  const maxDensity = Math.max(...bins.map((b) => b.density), 1e-9);
  const baseY = H - 6;
  const toY = (d: number) => baseY - (d / maxDensity) * (baseY - 6);

  const curve = bins
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${toX(b.x).toFixed(1)},${toY(b.density).toFixed(1)}`)
    .join(' ');
  const fill = `${curve} L${toX(bins[bins.length - 1]!.x).toFixed(1)},${baseY} L${toX(bins[0]!.x).toFixed(1)},${baseY} Z`;
  const nowX = toX(nowValue);
  const sigmaLoX = toX(mean - stddev);
  const sigmaHiX = toX(mean + stddev);
  const clipId = `clip-${label.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <div className={styles.block}>
      <div className={styles.header}>
        <span className={styles.name} style={{ color }}>
          {label}
        </span>
        <span className={styles.sigma} style={{ color }}>
          {fmtSigma(sigma)}
        </span>
        <span className={styles.chip} data-zone={zone ?? 'normal'} style={{ color }}>
          {(zone ?? 'normal').toUpperCase()}
        </span>
        <span className={styles.sub}>
          {percentile != null ? `${Math.round(percentile)}th` : '–'} · {fmtVp(nowValue)} · {atmText}
        </span>
        <svg className={styles.spark} width="64" height="18" viewBox="0 0 64 18" aria-hidden="true">
          <path d={sparkPath(spark)} fill="none" stroke={color} strokeWidth="1.2" opacity="0.65" />
        </svg>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} distribution`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={nowX} height={H} />
          </clipPath>
        </defs>
        <path
          d={fill}
          fill={color}
          fillOpacity="0.05"
          stroke={color}
          strokeWidth="1.2"
          strokeOpacity="0.8"
        />
        <path d={fill} fill={color} fillOpacity="0.18" clipPath={`url(#${clipId})`} />
        <line
          x1={sigmaLoX}
          y1="6"
          x2={sigmaLoX}
          y2={baseY}
          stroke="#3a4248"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <line
          x1={sigmaHiX}
          y1="6"
          x2={sigmaHiX}
          y2={baseY}
          stroke="#3a4248"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <line x1={nowX} y1="2" x2={nowX} y2={baseY + 2} stroke="#fff" strokeWidth="1.5" />
        <circle cx={nowX} cy="7" r="3" fill="#fff" />
        <line x1="10" y1={baseY} x2={W - 10} y2={baseY} stroke="#1a1f24" />
      </svg>
      <div className={styles.ends}>
        <span>cheap {fmtVp(rangeLo)}</span>
        <span>rich {fmtVp(rangeHi)}</span>
      </div>
    </div>
  );
}
