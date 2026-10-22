import { type Locale, useLocale, useT } from '@lib/i18n';
import { getTokenLogo } from '@lib/token-meta';
import type { IvHistoryResponse, IvTenor } from '@shared/enriched';
import { useState } from 'react';
import { getHistoryCoverage } from './history-coverage';
import { skewMessages } from './i18n';
import { type IvHistoryWindow, useIvHistory } from './queries';
import styles from './SkewHistory.module.css';
import SkewRegime from './SkewRegime';
import SkewSmileChart from './SkewSmileChart';
import SkewTimeline from './SkewTimeline';
import type { SurfaceMarket } from './surface-market';
import {
  buildSkewLineData,
  describeSkew,
  latestSkewDisplayValue,
  pickReferencePoint,
  reconstructSmile,
  shortPercentile,
} from './skew-history-utils';

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const LOOKBACKS: { key: IvHistoryWindow; label: 'lb30' | 'lb90' }[] = [
  { key: '30d', label: 'lb30' },
  { key: '90d', label: 'lb90' },
];
const MODELS = [
  { key: 'v1', label: 'v1', title: 'modelV1Title' },
  { key: 'v2', label: 'v2', title: 'modelV2Title' },
] as const;
type SkewModel = (typeof MODELS)[number]['key'];
const RR_COLOR = '#50d2c1';
const FLY_COLOR = '#f59e0b';
const VS_OPTIONS: { key: string; label: 'vs1d' | 'vs7d' | 'vs30d'; days: number }[] = [
  { key: '1d', label: 'vs1d', days: 1 },
  { key: '7d', label: 'vs7d', days: 7 },
  { key: '30d', label: 'vs30d', days: 30 },
];

function RrTipBody() {
  const t = useT(skewMessages);
  return (
    <>
      <div>call25 IV − put25 IV.</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
        <li>{t('rrTip1')}</li>
        <li>{t('rrTip2')}</li>
        <li>{t('chartTip')}</li>
      </ul>
    </>
  );
}

function FlyTipBody() {
  const t = useT(skewMessages);
  return (
    <>
      <div>(call25 IV + put25 IV) / 2 − ATM IV.</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
        <li>{t('flyTip1')}</li>
        <li>{t('flyTip2')}</li>
        <li>{t('chartTip')}</li>
      </ul>
    </>
  );
}

function fmtCell(
  value: number | null | undefined,
  pct: number | null | undefined,
  locale: Locale,
): string {
  if (value == null || !Number.isFinite(value)) return '–';
  const v = value * 100;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}${pct != null ? ` · ${shortPercentile(pct, locale)}` : ''}`;
}

function TermStrip({ data, active }: { data: IvHistoryResponse | undefined; active: IvTenor }) {
  const t = useT(skewMessages);
  const locale = useLocale();
  const rows = [
    { label: 'RR', value: 'rr25d', pct: 'rrPercentile' },
    { label: 'Fly', value: 'bfly25d', pct: 'flyPercentile' },
  ] as const;
  return (
    <div className={styles.term} role="table" aria-label={t('byTenorAria')}>
      <span className={styles.termHead} role="columnheader">
        {t('byTenor')}
      </span>
      {TENORS.map((tenor) => (
        <span
          key={tenor}
          className={styles.termHead}
          data-active={tenor === active ? 'true' : undefined}
          role="columnheader"
        >
          {tenor}
        </span>
      ))}
      {rows.map((row) => (
        <div key={row.label} className={styles.termRow} role="row">
          <span className={styles.termLabel}>{row.label}</span>
          {TENORS.map((tenor) => {
            const r = data?.tenors[tenor];
            return (
              <span
                key={tenor}
                className={styles.termCell}
                data-active={tenor === active ? 'true' : undefined}
              >
                {fmtCell(r?.current?.[row.value], r?.[row.pct], locale)}
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
  market?: SurfaceMarket;
}

export default function SkewHistory({ underlying, market = 'crypto' }: Props) {
  const t = useT(skewMessages);
  const locale = useLocale();
  const [window, setWindow] = useState<IvHistoryWindow>('30d');
  const [tenor, setTenor] = useState<IvTenor>('30d');
  const [vsKey, setVsKey] = useState<string>('7d');
  const [model, setModel] = useState<SkewModel>('v1');

  const { data, isPlaceholderData, isLoading } = useIvHistory(underlying, window, tenor, true, market);
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

  const coverage = getHistoryCoverage(series, window, ['rr25d', 'bfly25d'], locale);
  const vsLabel = t(vs.label);
  const atmPctText = (value: number | null) =>
    value == null || !Number.isFinite(value) ? '' : t('ofAtm', { v: value.toFixed(1) });
  const logo = getTokenLogo(underlying);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>
          {logo && <img src={logo} alt="" className={styles.tokenLogo} />}
          {underlying} SKEW
        </span>
        <div className={styles.toggles}>
          <span className={styles.toggleLabel}>{t('model')}</span>
          <div className={styles.toggleGroup}>
            {MODELS.map((m) => (
              <button
                key={m.key}
                type="button"
                title={t(m.title)}
                className={styles.toggleBtn}
                data-active={model === m.key ? 'true' : undefined}
                onClick={() => setModel(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className={styles.toggleLabel} title={t('tenorTitle')}>
            {t('tenor')}
          </span>
          <div className={styles.toggleGroup}>
            {TENORS.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.toggleBtn}
                data-active={tenor === option ? 'true' : undefined}
                onClick={() => setTenor(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <span className={styles.toggleLabel} title={t('lookbackTitle')}>
            {t('lookback')}
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
                {t(w.label)}
              </button>
            ))}
          </div>
          {model === 'v1' && (
            <>
              <span className={styles.toggleLabel} title={t('vsTitle')}>
                {t('vs')}
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
                    {t(o.label)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {model === 'v2' && <SkewRegime underlying={underlying} tenor={tenor} lookback={window} market={market} />}

      {model === 'v1' && (
        <>
          <SkewTimeline
            label="25Δ RR"
            title={t('rrTitle')}
            tip={<RrTipBody />}
            color={RR_COLOR}
            points={rrPoints}
            percentile={rrPct}
            atmText={atmPctText(latestSkewDisplayValue(series, 'rr25d', 'normalized'))}
            refValue={refPoint?.rr25d != null ? refPoint.rr25d * 100 : null}
            refTimeMs={refPoint?.ts ?? null}
            refLabel={vsLabel}
            upLabel={t('callsBid')}
            downLabel={t('putsBid')}
            loading={loading}
          />
          <SkewTimeline
            label="25Δ Fly"
            title={t('flyTitle')}
            tip={<FlyTipBody />}
            color={FLY_COLOR}
            points={flyPoints}
            percentile={flyPct}
            atmText={atmPctText(latestSkewDisplayValue(series, 'bfly25d', 'normalized'))}
            refValue={refPoint?.bfly25d != null ? refPoint.bfly25d * 100 : null}
            refTimeMs={refPoint?.ts ?? null}
            refLabel={vsLabel}
            upLabel={t('wingsRich')}
            downLabel={t('wingsCheap')}
            loading={loading}
          />

          <TermStrip data={data} active={tenor} />

          <SkewSmileChart now={nowSmile} reference={refSmile} referenceLabel={vsLabel} />

          <div className={styles.foot}>
            <span className={styles.coverage} data-short={coverage.short ? 'true' : undefined}>
              {coverage.label}
            </span>
            <span className={styles.takeaway}>{describeSkew(rrNow, rrPct, flyNow, flyPct, locale)}</span>
          </div>
        </>
      )}
    </div>
  );
}
