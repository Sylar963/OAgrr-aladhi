import { useState } from 'react';

import InfoTip from '@components/ui/InfoTip';
import { useLocale, useT } from '@lib/i18n';
import type { IvTenor } from '@shared/enriched';

import {
  CALL_PUT_FLOW_RESOLUTION_SEC,
  type IvHistoryWindow,
  useCallPutFlow,
  useIvHistory,
} from './queries';
import { skewMessages, surfaceMessages } from './i18n';
import styles from './SkewRegime.module.css';
import SkewRegimeChart, { REGIME_COLORS } from './SkewRegimeChart';
import type { SurfaceMarket } from './surface-market';
import {
  computeRegime,
  currentRun,
  describeRegime,
  flowSeries,
  formatDuration,
  formatRegimeValue,
  REGIME_EXIT_FRACTION,
  REGIME_K,
  REGIME_SMOOTH_SEC,
  type RegimeSource,
  regimeLabel,
  regimeShare,
  rrSeries,
  shareText,
} from './skew-regime';

type SourceLabelKey = 'srcContracts' | 'srcNotional' | 'srcPremium' | 'srcRr';

const SOURCES: { key: RegimeSource; label: SourceLabelKey; title: `${SourceLabelKey}Title` }[] = [
  { key: 'contracts', label: 'srcContracts', title: 'srcContractsTitle' },
  { key: 'notional', label: 'srcNotional', title: 'srcNotionalTitle' },
  { key: 'premium', label: 'srcPremium', title: 'srcPremiumTitle' },
  { key: 'rr', label: 'srcRr', title: 'srcRrTitle' },
];
const ZONES: { key: string; label: string; days: number }[] = [
  { key: '1d', label: '1d', days: 1 },
  { key: '3d', label: '3d', days: 3 },
  { key: '7d', label: '7d', days: 7 },
];
const LOOKBACK_DAYS: Record<IvHistoryWindow, number> = { '30d': 30, '90d': 90 };
const MAX_FLOW_DAYS = 90;

function TipBody() {
  const t = useT(skewMessages);
  return (
    <>
      <div>{t('tip0')}</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
        <li>{t('tip1')}</li>
        <li>{t('tip2', { k: REGIME_K })}</li>
        <li>{t('tip3')}</li>
        <li>{t('tip4')}</li>
        <li>{t('tip5')}</li>
      </ul>
    </>
  );
}

interface Props {
  underlying: string;
  tenor: IvTenor;
  lookback: IvHistoryWindow;
  market?: SurfaceMarket;
}

// The TradFi service has no trade-flow history, so only the RR source applies there.
const TRADFI_SOURCES = SOURCES.filter((s) => s.key === 'rr');

export default function SkewRegime({ underlying, tenor, lookback, market = 'crypto' }: Props) {
  const t = useT(skewMessages);
  const ts = useT(surfaceMessages);
  const locale = useLocale();
  const tradfi = market === 'tradfi';
  const sources = tradfi ? TRADFI_SOURCES : SOURCES;
  const [source, setSource] = useState<RegimeSource>(tradfi ? 'rr' : 'contracts');
  const [zoneKey, setZoneKey] = useState('3d');
  const zone = ZONES.find((z) => z.key === zoneKey) ?? ZONES[1]!;
  const lookbackDays = LOOKBACK_DAYS[lookback];
  const isFlow = source !== 'rr';

  const flow = useCallPutFlow(
    underlying,
    Math.min(MAX_FLOW_DAYS, lookbackDays + zone.days + 1),
    isFlow,
  );
  const iv = useIvHistory(underlying, '90d', tenor, !isFlow, market);

  const nowSec = Math.floor(Date.now() / 1000);
  const series =
    source === 'rr'
      ? rrSeries(iv.data?.tenors[tenor]?.series ?? [])
      : flow.data
        ? flowSeries(
            flow.data.buckets,
            source,
            flow.data.start,
            CALL_PUT_FLOW_RESOLUTION_SEC,
            nowSec,
          )
        : [];
  const all = computeRegime(series, {
    smoothSec: REGIME_SMOOTH_SEC[source],
    bandSec: zone.days * 86_400,
    k: REGIME_K,
    exitFraction: REGIME_EXIT_FRACTION,
  });
  const visibleFrom = nowSec - lookbackDays * 86_400;
  const points = all.filter((p) => p.time >= visibleFrom);

  const loading = isFlow ? flow.isLoading || flow.isPlaceholderData : iv.isLoading;
  const unavailable = isFlow && flow.data?.available === false;
  const run = currentRun(points);
  const last = points.at(-1);

  let status: string | null = null;
  if (unavailable) status = t('storeUnavailable');
  else if (loading && points.length < 2) status = isFlow ? t('loadingFlow') : ts('loading');
  else if (flow.isError && isFlow) status = t('flowFailed');
  else if (points.length < 2) status = ts('insufficientHistory');

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.name}>
          {t('regime')}
          <InfoTip label={t('regimeLabel')} title={t('regimeTitle')} align="start">
            <TipBody />
          </InfoTip>
        </span>
        {run && (
          <span
            className={styles.chip}
            style={{ color: REGIME_COLORS[run.regime], borderColor: REGIME_COLORS[run.regime] }}
          >
            {regimeLabel(run.regime, locale)}
          </span>
        )}
        {run && last && (
          <span className={styles.sub}>
            {t('forDuration', { d: formatDuration(last.time - run.since) })}
          </span>
        )}
        {last && (
          <span className={styles.value}>{formatRegimeValue(last.value, source, underlying)}</span>
        )}
        {status && <span className={styles.muted}>{status}</span>}
      </div>

      <div className={styles.controls}>
        <span className={styles.controlLabel}>{t('source')}</span>
        <div className={styles.toggleGroup}>
          {sources.map((s) => (
            <button
              key={s.key}
              type="button"
              title={t(s.title)}
              className={styles.toggleBtn}
              data-active={source === s.key ? 'true' : undefined}
              onClick={() => setSource(s.key)}
            >
              {t(s.label)}
            </button>
          ))}
        </div>
        <span className={styles.controlLabel} title={t('zonesTitle')}>
          {t('zones')}
        </span>
        <div className={styles.toggleGroup}>
          {ZONES.map((z) => (
            <button
              key={z.key}
              type="button"
              aria-label={t('zoneAria', { label: z.label })}
              className={styles.toggleBtn}
              data-active={zoneKey === z.key ? 'true' : undefined}
              onClick={() => setZoneKey(z.key)}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      <SkewRegimeChart points={points} source={source} underlying={underlying} />

      <div className={styles.legend}>
        {(['risk-on', 'neutral', 'risk-off'] as const).map((r) => (
          <span key={r} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: REGIME_COLORS[r] }} />
            {regimeLabel(r, locale)}
          </span>
        ))}
        <span className={styles.legendItem}>
          <span className={styles.zoneSwatch} />
          {t('zonesLegend', { k: REGIME_K, label: zone.label })}
        </span>
        <span className={styles.scope}>
          {isFlow ? t('scopeFlow') : t('scopeRr', { tenor })}
        </span>
      </div>

      <div className={styles.foot}>
        <span className={styles.share}>{shareText(regimeShare(points), locale)}</span>
        <span className={styles.takeaway}>
          {points.length >= 2 ? describeRegime(points, source, underlying, zone.label, locale) : ''}
        </span>
      </div>
    </div>
  );
}
