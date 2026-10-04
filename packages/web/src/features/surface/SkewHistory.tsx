import { getTokenLogo } from '@lib/token-meta';
import type { IvHistoryResponse, IvTenor } from '@shared/enriched';
import { useState } from 'react';
import { getHistoryCoverage } from './history-coverage';
import { type IvHistoryWindow, useIvHistory } from './queries';
import styles from './SkewHistory.module.css';
import SkewSmileChart from './SkewSmileChart';
import SkewTimeline from './SkewTimeline';
import {
  buildSkewLineData,
  describeSkew,
  latestSkewDisplayValue,
  ordinal,
  pickReferencePoint,
  reconstructSmile,
} from './skew-history-utils';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const LOOKBACKS: { key: IvHistoryWindow; label: string }[] = [
  { key: '30d', label: '1M' },
  { key: '90d', label: '3M' },
];
const RR_COLOR = '#50d2c1';
const FLY_COLOR = '#f59e0b';
const VS_OPTIONS: { key: string; label: string; days: number }[] = [
  { key: '1d', label: '1d ago', days: 1 },
  { key: '7d', label: '7d ago', days: 7 },
  { key: '30d', label: '30d ago', days: 30 },
];

const RR_TIP_BODY = (
  <>
    <div>call25 IV − put25 IV.</div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>Negative: puts richer than calls → downside fear (usual in BTC/ETH).</li>
      <li>Positive: calls richer → upside FOMO. Near zero = balanced.</li>
      <li>Chart: shaded band = 10th–90th pct of the lookback, dashed = median, vertical = VS point.</li>
    </ul>
  </>
);
const FLY_TIP_BODY = (
  <>
    <div>(call25 IV + put25 IV) / 2 − ATM IV.</div>
    <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
      <li>High: wings expensive (fat-tail / event premium).</li>
      <li>Low/negative: wings cheap vs body.</li>
      <li>Chart: shaded band = 10th–90th pct of the lookback, dashed = median, vertical = VS point.</li>
    </ul>
  </>
);

function atmPctText(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '' : `${value.toFixed(1)}% of ATM`;
}

function fmtCell(value: number | null | undefined, pct: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–';
  const v = value * 100;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}${pct != null ? ` · ${ordinal(pct)}` : ''}`;
}

function TermStrip({ data, active }: { data: IvHistoryResponse | undefined; active: IvTenor }) {
  const rows = [
    { label: 'RR', value: 'rr25d', pct: 'rrPercentile' },
    { label: 'Fly', value: 'bfly25d', pct: 'flyPercentile' },
  ] as const;
  return (
    <div className={styles.term} role="table" aria-label="skew by tenor">
      <span className={styles.termHead} role="columnheader">
        by tenor
      </span>
      {TENORS.map((t) => (
        <span
          key={t}
          className={styles.termHead}
          data-active={t === active ? 'true' : undefined}
          role="columnheader"
        >
          {t}
        </span>
      ))}
      {rows.map((row) => (
        <div key={row.label} className={styles.termRow} role="row">
          <span className={styles.termLabel}>{row.label}</span>
          {TENORS.map((t) => {
            const r = data?.tenors[t];
            return (
              <span
                key={t}
                className={styles.termCell}
                data-active={t === active ? 'true' : undefined}
              >
                {fmtCell(r?.current?.[row.value], r?.[row.pct])}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface Props {
  underlying: string;
}

export default function SkewHistory({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const [tenor, setTenor] = useState<IvTenor>('30d');
  const [vsKey, setVsKey] = useState<string>('7d');

  const { data, isPlaceholderData, isLoading } = useIvHistory(underlying, window, tenor);
  const result = data?.tenors[tenor];
  const series = result?.series ?? [];
  const current = result?.current;
  const loading = isLoading || isPlaceholderData;

  const nowSmile = current ? reconstructSmile(current) : [];
  const vs = VS_OPTIONS.find((o) => o.key === vsKey) ?? VS_OPTIONS[1]!;
  const refPoint = current ? pickReferencePoint(series, current.ts, vs.days) : null;
  const refSmile = refPoint ? reconstructSmile(refPoint) : null;

  const rrPoints = buildSkewLineData(series, 'rr25d', 'raw');
  const flyPoints = buildSkewLineData(series, 'bfly25d', 'raw');
  const rrNow = rrPoints.at(-1)?.value ?? null;
  const flyNow = flyPoints.at(-1)?.value ?? null;
  const rrPct = result?.rrPercentile ?? null;
  const flyPct = result?.flyPercentile ?? null;

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
          <span className={styles.toggleLabel} title="Constant-maturity option tenor">
            TENOR
          </span>
          <div className={styles.toggleGroup}>
            {TENORS.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.toggleBtn}
                data-active={tenor === t ? 'true' : undefined}
                onClick={() => setTenor(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <span className={styles.toggleLabel} title="History used for percentiles and charts">
            LOOKBACK
          </span>
          <div className={styles.toggleGroup}>
            {LOOKBACKS.map((w) => (
              <button
                key={w.key}
                type="button"
                className={styles.toggleBtn}
                data-active={window === w.key ? 'true' : undefined}
                onClick={() => setWindow(w.key)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <span className={styles.toggleLabel} title="Reference point for the dashed smile and Δ">
            VS
          </span>
          <div className={styles.toggleGroup}>
            {VS_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                className={styles.toggleBtn}
                data-active={vsKey === o.key ? 'true' : undefined}
                onClick={() => setVsKey(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SkewTimeline
        label="25Δ RR"
        title="25Δ Risk-Reversal"
        tip={RR_TIP_BODY}
        color={RR_COLOR}
        points={rrPoints}
        percentile={rrPct}
        atmText={atmPctText(latestSkewDisplayValue(series, 'rr25d', 'normalized'))}
        refValue={refPoint?.rr25d != null ? refPoint.rr25d * 100 : null}
        refTimeMs={refPoint?.ts ?? null}
        refLabel={vs.label}
        upLabel="calls bid"
        downLabel="puts bid"
        loading={loading}
      />
      <SkewTimeline
        label="25Δ Fly"
        title="25Δ Butterfly"
        tip={FLY_TIP_BODY}
        color={FLY_COLOR}
        points={flyPoints}
        percentile={flyPct}
        atmText={atmPctText(latestSkewDisplayValue(series, 'bfly25d', 'normalized'))}
        refValue={refPoint?.bfly25d != null ? refPoint.bfly25d * 100 : null}
        refTimeMs={refPoint?.ts ?? null}
        refLabel={vs.label}
        upLabel="wings rich"
        downLabel="wings cheap"
        loading={loading}
      />

      <TermStrip data={data} active={tenor} />

      <SkewSmileChart now={nowSmile} reference={refSmile} referenceLabel={vs.label} />

      <div className={styles.foot}>
        <span className={styles.coverage} data-short={coverage.short ? 'true' : undefined}>
          {coverage.label}
        </span>
        <span className={styles.takeaway}>{describeSkew(rrNow, rrPct, flyNow, flyPct)}</span>
      </div>
    </div>
  );
}
