import { useState } from 'react';

import InfoTip from '@components/ui/InfoTip';
import { getTokenLogo } from '@lib/token-meta';
import type { IvTenor } from '@shared/enriched';
import { getHistoryCoverage } from './history-coverage';
import { useIvHistory, type IvHistoryWindow } from './queries';
import SkewDensityStrip from './SkewDensityStrip';
import SkewSmileChart from './SkewSmileChart';
import {
  buildDistribution,
  buildSkewLineData,
  latestSkewDisplayValue,
  pickReferencePoint,
  reconstructSmile,
} from './skew-history-utils';
import styles from './SkewHistory.module.css';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const RR_COLOR = '#50d2c1';
const FLY_COLOR = '#f59e0b';
const VS_OPTIONS: { key: string; label: string; days: number | null }[] = [
  { key: '7d', label: '7d ago', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: 'open', label: 'open', days: null },
];

const RR_TIP_BODY = (
  <>
    <div>call25 IV − put25 IV.</div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>Negative: puts richer than calls → downside fear (usual in BTC/ETH).</li>
      <li>Positive: calls richer → upside FOMO. Near zero = balanced.</li>
    </ul>
  </>
);
const FLY_TIP_BODY = (
  <>
    <div>(call25 IV + put25 IV) / 2 − ATM IV.</div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>High: wings expensive (fat-tail / event premium).</li>
      <li>Low/negative: wings cheap vs body.</li>
    </ul>
  </>
);

function atmPctText(value: number | null): string {
  return value == null || !Number.isFinite(value) ? 'ATM n/a' : `${value.toFixed(1)}% ATM`;
}

function takeaway(rrPct: number | null, flyPct: number | null): string {
  const place = (p: number | null) =>
    p == null ? 'n/a' : p >= 85 ? 'rich' : p <= 15 ? 'cheap' : 'mid-range';
  return `Skew ${place(rrPct)} vs history — RR ${rrPct == null ? '–' : `${Math.round(rrPct)}th`}, Fly ${flyPct == null ? '–' : `${Math.round(flyPct)}th`}.`;
}

interface Props {
  underlying: string;
}

export default function SkewHistory({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const [tenor, setTenor] = useState<IvTenor>('30d');
  const [vsKey, setVsKey] = useState<string>('7d');

  const { data } = useIvHistory(underlying, window);
  const result = data?.tenors[tenor];
  const series = result?.series ?? [];
  const current = result?.current;

  const rrDist = buildDistribution(series, 'rr25d');
  const flyDist = buildDistribution(series, 'bfly25d');

  const nowSmile = current ? reconstructSmile(current) : [];
  const vs = VS_OPTIONS.find((o) => o.key === vsKey) ?? VS_OPTIONS[0]!;
  const refPoint =
    current == null
      ? null
      : vs.days == null
        ? (series[0] ?? null)
        : pickReferencePoint(series, current.ts, vs.days);
  const refSmile = refPoint ? reconstructSmile(refPoint) : null;

  const rrAtm = atmPctText(latestSkewDisplayValue(series, 'rr25d', 'normalized'));
  const flyAtm = atmPctText(latestSkewDisplayValue(series, 'bfly25d', 'normalized'));
  const rrSpark = buildSkewLineData(series, 'rr25d', 'raw');
  const flySpark = buildSkewLineData(series, 'bfly25d', 'raw');

  const coverage = getHistoryCoverage(series, window, ['rr25d', 'bfly25d']);
  const logo = getTokenLogo(underlying);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          {logo && <img src={logo} alt="" className={styles.tokenLogo} />}
          {underlying} SKEW
        </span>
        <div className={styles.toggles}>
          <span className={styles.toggleLabel}>TENOR</span>
          <div className={styles.toggleGroup}>
            {TENORS.map((t) => (
              <button key={t} type="button" className={styles.toggleBtn}
                data-active={tenor === t ? 'true' : undefined} onClick={() => setTenor(t)}>{t}</button>
            ))}
          </div>
          <span className={styles.toggleLabel}>WINDOW</span>
          <div className={styles.toggleGroup}>
            {(['30d', '90d'] as IvHistoryWindow[]).map((w) => (
              <button key={w} type="button" className={styles.toggleBtn}
                data-active={window === w ? 'true' : undefined} onClick={() => setWindow(w)}>{w}</button>
            ))}
          </div>
          <span className={styles.toggleLabel}>VS</span>
          <div className={styles.toggleGroup}>
            {VS_OPTIONS.map((o) => (
              <button key={o.key} type="button" className={styles.toggleBtn}
                data-active={vsKey === o.key ? 'true' : undefined} onClick={() => setVsKey(o.key)}>{o.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: RR_COLOR }} />
          25Δ RR (call − put)
          <InfoTip label="25Δ RR" title="25Δ Risk-Reversal" align="start">{RR_TIP_BODY}</InfoTip>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: FLY_COLOR }} />
          25Δ Fly (wing − ATM)
          <InfoTip label="25Δ Fly" title="25Δ Butterfly" align="start">{FLY_TIP_BODY}</InfoTip>
        </span>
      </div>

      <SkewDensityStrip label="25Δ RR" color={RR_COLOR} distribution={rrDist} atmText={rrAtm} spark={rrSpark} />
      <SkewDensityStrip label="25Δ Fly" color={FLY_COLOR} distribution={flyDist} atmText={flyAtm} spark={flySpark} />

      <SkewSmileChart now={nowSmile} reference={refSmile} referenceLabel={vs.label} />

      <div className={styles.foot}>
        <span className={styles.coverage} data-short={coverage.short ? 'true' : undefined}>{coverage.label}</span>
        <span className={styles.takeaway}>
          {takeaway(result?.rrPercentile ?? null, result?.flyPercentile ?? null)}
        </span>
      </div>
    </div>
  );
}
