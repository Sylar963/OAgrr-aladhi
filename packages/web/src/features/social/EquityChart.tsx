import type { EquityPointDto } from '@oggregator/protocol';
import { defineMessages, useT } from '@lib/i18n';
import { useId } from 'react';

import styles from './EquityChart.module.css';

const messages = defineMessages(
  { equitySinceStart: 'Equity since start' },
  { equitySinceStart: 'Equity desde el inicio' },
);

const WIDTH = 600;
const HEIGHT = 140;

interface EquityChartProps {
  points: EquityPointDto[];
  baselineUsd: number;
}

export default function EquityChart({ points, baselineUsd }: EquityChartProps) {
  const t = useT(messages);
  const gradientId = useId();
  if (points.length < 2) return null;

  const times = points.map((p) => Date.parse(p.ts));
  const values = points.map((p) => p.equityUsd);
  const t0 = times[0]!;
  const t1 = Math.max(times.at(-1)!, t0 + 1);
  const lo = Math.min(...values, baselineUsd);
  const hi = Math.max(...values, baselineUsd);
  const pad = (hi - lo) * 0.1 || Math.max(hi * 0.001, 1);
  const yMin = lo - pad;
  const yMax = hi + pad;

  const x = (t: number) => ((t - t0) / (t1 - t0)) * WIDTH;
  const y = (v: number) => HEIGHT - ((v - yMin) / (yMax - yMin)) * HEIGHT;
  const line = points.map((_, i) => `${x(times[i]!).toFixed(1)},${y(values[i]!).toFixed(1)}`);
  const up = values.at(-1)! >= baselineUsd;

  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t('equitySinceStart')}
      data-tone={up ? 'up' : 'down'}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" className={styles.fillStart} />
          <stop offset="100%" className={styles.fillEnd} />
        </linearGradient>
      </defs>
      <line
        className={styles.baseline}
        x1={0}
        x2={WIDTH}
        y1={y(baselineUsd)}
        y2={y(baselineUsd)}
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        fill={`url(#${gradientId})`}
        points={`0,${HEIGHT} ${line.join(' ')} ${WIDTH},${HEIGHT}`}
      />
      <polyline
        className={styles.line}
        points={line.join(' ')}
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
