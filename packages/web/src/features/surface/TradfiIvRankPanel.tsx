import { useState } from 'react';

import HoverTooltip from '@components/ui/HoverTooltip';
import { useTradfiSelection } from '@features/tradfi';
import { useT } from '@lib/i18n';
import type { TradfiVolHistoryResponse, TradfiVolRank } from '@oggregator/protocol';
import type { IvHistoryPoint, IvHistoryTenorResult } from '@shared/enriched';
import { ivRankMessages } from './i18n';
import { Chip } from './IvRankPanel';
import { useSurface, useTradfiVolHistory } from './queries';
import { TRADFI_SURFACE_VENUES } from './surface-market';
import VolConeChart, { type ConeIvPoint } from './VolConeChart';
import styles from './IvRankPanel.module.css';

type Lookback = '6m' | '1y';
type Field = 'iv' | 'rv';

const CONE_TENORS = [
  ['7d', 7],
  ['30d', 30],
  ['60d', 60],
  ['90d', 90],
] as const;

const LOOKBACKS: Lookback[] = ['6m', '1y'];
const LOOKBACK_LABEL: Record<Lookback, 'lb6m' | 'lb1y'> = { '6m': 'lb6m', '1y': 'lb1y' };

function latest(series: TradfiVolHistoryResponse['series'], field: Field) {
  for (let i = series.length - 1; i >= 0; i--) if (series[i]![field] != null) return series[i]!;
  return undefined;
}

function point(ts: number, value: number | null): IvHistoryPoint {
  return { ts, atmIv: value, rr25d: null, bfly25d: null, rr10d: null, bfly10d: null };
}

/** Feeds a daily IV or RV series to the crypto chip, which reads only the ATM fields. */
function chipResult(
  history: TradfiVolHistoryResponse,
  rank: TradfiVolRank,
  field: Field,
): IvHistoryTenorResult {
  const window = history.series.slice(-rank.lookbackDays);
  const last = latest(window, field);
  return {
    current: point(last?.ts ?? 0, last?.[field] ?? null),
    atmRank: rank.rank,
    atmPercentile: rank.percentile,
    rrRank: null,
    rrPercentile: null,
    flyRank: null,
    flyPercentile: null,
    min: { atmIv: rank.min, rr25d: null, bfly25d: null },
    max: { atmIv: rank.max, rr25d: null, bfly25d: null },
    series: window.map((p) => point(p.ts, p[field])),
  };
}

function TitleTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t('ivrTipTitle')}</div>
      <div>{t('tfTipBody')}</div>
      <div className={styles.tipFormula}>rank = (current − min) / (max − min) × 100</div>
      <ul className={styles.tipList}>
        <li>
          <b>30D IV</b>
          {t('tfTipIv')}
        </li>
        <li>
          <b>21D RV</b>
          {t('tfTipRv')}
        </li>
        <li>{t('tfTipLookbacks')}</li>
      </ul>
    </div>
  );
}

function SamplesTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t('samplesTitle')}</div>
      <div>{t('tfSamplesBody')}</div>
    </div>
  );
}

function ConeTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t('coneTipTitle')}</div>
      <div>{t('tfConeBody')}</div>
      <ul className={styles.tipList}>
        <li>{t('coneTipBands')}</li>
        <li>
          <b style={{ color: 'var(--accent-primary)' }}>{t('coneTipTeal')}</b>
          {t('tfConeTealBody')}
        </li>
        <li>
          <b style={{ color: '#f7a600' }}>{t('coneTipOrange')}</b>
          {t('coneTipOrangeBody')}
        </li>
      </ul>
    </div>
  );
}

export default function TradfiIvRankPanel() {
  const t = useT(ivRankMessages);
  const { underlying } = useTradfiSelection();
  const [lookback, setLookback] = useState<Lookback>('1y');
  const { data } = useTradfiVolHistory(underlying);
  const { data: surface } = useSurface(underlying, TRADFI_SURFACE_VENUES, 'tradfi');
  const coneIvPoints: ConeIvPoint[] = CONE_TENORS.flatMap(([tenor, days]) => {
    const iv = surface?.atmIvTenors?.[tenor];
    return iv == null ? [] : [{ days, iv }];
  });
  const first = data?.series[0];

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <HoverTooltip as="span" className={styles.title} placement="bottom-start" content={<TitleTip />}>
          <span className={styles.titleTrigger}>{underlying} IV RANK</span>
        </HoverTooltip>
        <div className={styles.windowToggle}>
          {LOOKBACKS.map((w) => (
            <button
              key={w}
              type="button"
              className={styles.windowBtn}
              data-active={lookback === w ? 'true' : undefined}
              onClick={() => setLookback(w)}
            >
              {t(LOOKBACK_LABEL[w])}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.coverage}>
        {first
          ? t('dailySince', {
              date: new Date(first.ts).toISOString().slice(0, 10),
              source: data.ivSource,
            })
          : t('loadingDaily')}
      </div>

      <div className={styles.grid} data-cols="2">
        <Chip
          label={`30D IV · ${data?.ivSource ?? 'IVx'}`}
          result={data ? chipResult(data, data.ivRank[lookback], 'iv') : undefined}
          richness={null}
          showRichness={false}
          samplesTip={<SamplesTip />}
        />
        <Chip
          label={`${data?.rvWindowDays ?? 21}D RV`}
          result={data ? chipResult(data, data.rvRank[lookback], 'rv') : undefined}
          richness={null}
          showRichness={false}
          samplesTip={<SamplesTip />}
        />
      </div>

      <div className={styles.coneSection}>
        <div className={styles.coneHeader}>
          <HoverTooltip as="span" className={styles.coneTitle} placement="bottom-start" content={<ConeTip />}>
            <span className={styles.titleTrigger}>{t('coneTitle')}</span>
          </HoverTooltip>
          <div className={styles.legend}>
            <span>
              <i className={styles.lgIv} />
              ATM IV
            </span>
            <span>
              <i className={styles.lgRv} />
              {t('legendRvNow')}
            </span>
            <span>
              <i className={styles.lgMedian} />
              {t('legendMedian')}
            </span>
            <span>
              <i className={styles.lgBand} />
              {t('legendBands')}
            </span>
          </div>
        </div>
        <VolConeChart bands={data?.volCone ?? []} ivPoints={coneIvPoints} />
      </div>
    </div>
  );
}
