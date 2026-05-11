import { useState } from 'react';

import InfoTip from '@components/ui/InfoTip';
import { getTokenLogo } from '@lib/token-meta';
import { fmtIv } from '@lib/format';
import type { IvHistoryTenorResult, IvTenor } from '@shared/enriched';
import { getHistoryCoverage, type HistoryCoverage } from './history-coverage';
import { useIvHistory, type IvHistoryWindow } from './queries';
import styles from './IvRankPanel.module.css';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const SPARK_POINTS = 24;

const RANK_TIP =
  'IV RANK — where current ATM IV sits in the window\'s low→high range.\n\n' +
  '• 0 = at window low (cheapest seen). 100 = at window high (richest seen).\n' +
  '• >70 (red): premium is rich historically — prefer selling vol.\n' +
  '• 30–70 (amber): middle of the range. No strong edge.\n' +
  '• <30 (green): premium is cheap historically — prefer buying vol.';

const PCT_TIP =
  'IV PERCENTILE — share of historical samples ≤ current IV.\n\n' +
  '• Robust to outliers (one extreme print does not move the needle).\n' +
  '• 50% = half the history was lower. 90% = only 10% of the window has been richer.\n' +
  '• Pair with IV RANK: divergence flags outlier-distorted distributions.';

function rankLevel(rank: number | null): 'hot' | 'mid' | 'cold' | 'none' {
  if (rank == null) return 'none';
  if (rank >= 70) return 'hot';
  if (rank <= 30) return 'cold';
  return 'mid';
}

function sparkPath(values: Array<number | null>, width: number, height: number): string {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return '';
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min;
  const step = width / (xs.length - 1);
  return xs
    .map((v, i) => {
      const x = i * step;
      const y = span > 0 ? height - ((v - min) / span) * height : height / 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function sampleEvenly<T>(arr: T[], targetCount: number): T[] {
  if (arr.length <= targetCount) return arr;
  const step = arr.length / targetCount;
  const out: T[] = [];
  for (let i = 0; i < targetCount; i++) {
    out.push(arr[Math.floor(i * step)]!);
  }
  // Always include the last point so the spark ends on the current sample.
  if (out[out.length - 1] !== arr[arr.length - 1]) {
    out[out.length - 1] = arr[arr.length - 1]!;
  }
  return out;
}

const SAMPLES_TIP =
  'SAMPLES — how many valid ATM IV readings are in this window.\n\n' +
  '• 30d BTC/ETH seeds from ~1 year of Deribit DVOL candles on startup.\n' +
  '• Other tenors accumulate one new point every 5 min from the live surface.\n' +
  '• Rank/percentile need ≥ 2 distinct samples — they show “–” until the window has variation.';

const IVR_TIP_BODY = (
  <>
    <div>Where current ATM IV sits within the look-back window (toggle above).</div>
    <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)' }}>
      rank = (current − min) / (max − min) × 100
    </div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>
        <b style={{ color: 'var(--color-profit)' }}>0–30</b>: IV is cheap vs the window — vol buyers
        favored.
      </li>
      <li>
        <b style={{ color: 'var(--color-warning)' }}>30–70</b>: mid-range; no strong edge.
      </li>
      <li>
        <b style={{ color: 'var(--color-loss)' }}>70–100</b>: IV is rich vs the window — vol sellers
        favored.
      </li>
    </ul>
    <div style={{ marginTop: 8 }}>
      <b>pct</b> — share of past samples ≤ current IV. Robust to single outlier prints; pair with
      rank to spot outlier-distorted distributions.
    </div>
    <div style={{ marginTop: 6 }}>
      <b>n</b> — valid samples in the window. Rank/pct show “–” until n ≥ 2 with a non-zero range.
    </div>
    <div style={{ marginTop: 8 }}>
      <b>Per-tenor methodology</b>
      <ul style={{ margin: '4px 0 0', paddingLeft: 14 }}>
        <li>
          <b>30d</b> (BTC/ETH): Deribit DVOL — seeded with ~1 year of daily closes, kept live by the
          DVOL push.
        </li>
        <li>
          <b>7d / 60d / 90d</b>: cross-venue ATM averages interpolated to the tenor, snapshotted
          every 5 min.
        </li>
        <li>
          A fresh server start leaves 7d/60d/90d thinly populated until enough live snapshots
          accumulate — “n” reveals this.
        </li>
      </ul>
    </div>
  </>
);

function Chip({ tenor, result }: { tenor: IvTenor; result: IvHistoryTenorResult | undefined }) {
  const series = result?.series ?? [];
  const n = series.filter((p) => p.atmIv != null).length;
  const currentIv = result?.current.atmIv ?? null;
  const sampled = sampleEvenly(series, SPARK_POINTS);
  const path = sparkPath(
    sampled.map((p) => p.atmIv),
    100,
    22,
  );
  const level = rankLevel(result?.atmRank ?? null);
  return (
    <div className={styles.chip}>
      <div className={styles.chipTenor}>{tenor.toUpperCase()}</div>
      <div className={styles.chipIv}>{fmtIv(currentIv)}</div>
      <svg className={styles.spark} viewBox="0 0 100 22" preserveAspectRatio="none">
        {path && (
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className={styles.chipBadges}>
        <span className={styles.badge} title={RANK_TIP}>
          rank{' '}
          <span className={styles.rankValue} data-level={level}>
            {result?.atmRank != null ? result.atmRank.toFixed(0) : '–'}
          </span>
        </span>
        <span className={styles.badge} title={PCT_TIP}>
          pct{' '}
          <span className={styles.rankValue} data-level={level}>
            {result?.atmPercentile != null ? `${result.atmPercentile.toFixed(0)}%` : '–'}
          </span>
        </span>
        <span className={styles.badge} title={SAMPLES_TIP}>
          n <span className={styles.rankValue} data-level="none">{n}</span>
        </span>
      </div>
    </div>
  );
}

interface Props {
  underlying: string;
}

function shortestCoverage(results: Array<IvHistoryTenorResult | undefined>, window: IvHistoryWindow): HistoryCoverage {
  const coverages = results.map((result) => getHistoryCoverage(result?.series ?? [], window, ['atmIv']));
  return coverages.reduce((min, item) => (item.coverageMs < min.coverageMs ? item : min));
}

export default function IvRankPanel({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const { data } = useIvHistory(underlying, window);
  const logo = getTokenLogo(underlying);
  const coverage = shortestCoverage(
    TENORS.map((t) => data?.tenors[t]),
    window,
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          {logo && <img src={logo} alt="" className={styles.tokenLogo} />}
          {underlying} IV RANK
          <InfoTip label="IV Rank" title="How to read IV Rank" align="start">
            {IVR_TIP_BODY}
          </InfoTip>
        </span>
        <div className={styles.windowToggle}>
          <button
            type="button"
            className={styles.windowBtn}
            data-active={window === '30d' ? 'true' : undefined}
            onClick={() => setWindow('30d')}
          >
            30d
          </button>
          <button
            type="button"
            className={styles.windowBtn}
            data-active={window === '90d' ? 'true' : undefined}
            onClick={() => setWindow('90d')}
          >
            90d
          </button>
        </div>
      </div>
      <div className={styles.coverage} data-short={coverage.short ? 'true' : undefined}>
        {coverage.label}
      </div>

      <div className={styles.grid}>
        {TENORS.map((t) => (
          <Chip key={t} tenor={t} result={data?.tenors[t]} />
        ))}
      </div>
    </div>
  );
}
