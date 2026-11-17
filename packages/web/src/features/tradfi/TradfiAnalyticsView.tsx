import { Spinner } from '@components/ui';
import { useT } from '@lib/i18n';
import { useAppStore } from '@stores/app-store';
import { useEffect, useState } from 'react';
import { ActivityPanels } from './analytics/ActivityPanels';
import styles from './analytics/Analytics.module.css';
import {
  type ActivityMetric,
  type ActivityUnit,
  coverage,
  formatActivity,
  formatRatio,
  totalActivity,
} from './analytics/format';
import { analyticsMessages } from './analytics/messages';
import { ParityPanel } from './analytics/ParityPanel';
import { useTradfiAnalytics } from './analytics/queries';
import { useTradfiUnderlyings } from './queries';

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export default function TradfiAnalyticsView() {
  const underlying = useAppStore((s) => s.tradfiUnderlying);
  const setUnderlying = useAppStore((s) => s.setTradfiUnderlying);
  const underlyings = useTradfiUnderlyings().data?.underlyings;
  useEffect(() => {
    if (underlyings?.length && !underlyings.includes(underlying)) setUnderlying(underlyings[0]!);
  }, [underlying, underlyings, setUnderlying]);
  return <AnalyticsWorkspace key={underlying} underlying={underlying} />;
}

function AnalyticsWorkspace({ underlying }: { underlying: string }) {
  const t = useT(analyticsMessages);
  const [expiry, setExpiry] = useState('');
  const [metric, setMetric] = useState<ActivityMetric>('volume');
  const [unit, setUnit] = useState<ActivityUnit>('contracts');
  const query = useTradfiAnalytics(underlying, expiry);
  const data = query.data;
  if (query.isLoading) return <Spinner size="lg" label={t('loading')} />;
  if (!data)
    return (
      <div className={styles.empty} role="status">
        {query.error?.message ?? t('noData')}{' '}
        <button type="button" onClick={() => void query.refetch()}>
          {t('retry')}
        </button>
      </div>
    );
  const observed = coverage(data.summary);
  const partial = observed.volume < observed.total || observed.oi < observed.total;
  const kpis = [
    [t('totalVolume'), formatActivity(totalActivity(data.summary, 'volume', unit), unit)],
    [t('totalOi'), formatActivity(totalActivity(data.summary, 'oi', unit), unit)],
    [
      t('callVolume'),
      formatActivity(
        unit === 'usd' ? data.summary.call.volumeNotionalUsd : data.summary.call.volume,
        unit,
      ),
    ],
    [
      t('putVolume'),
      formatActivity(
        unit === 'usd' ? data.summary.put.volumeNotionalUsd : data.summary.put.volume,
        unit,
      ),
    ],
    [t('pcVolume'), formatRatio(data.summary.putCallVolumeRatio)],
    [t('pcOi'), formatRatio(data.summary.putCallOiRatio)],
  ];
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{underlying} / TRADFI</span>
          <h1>{t('title')}</h1>
        </div>
        <div className={styles.meta}>
          {data.sessionDate ? t('session', { date: data.sessionDate }) : t('unknownSession')}
          <br />
          {t('snapshot', { time: `${TIME.format(data.asOf)} ET` })}
        </div>
      </header>
      <div className={styles.controls}>
        <label>
          {t('expiry')}
          <select
            aria-label={t('expiry')}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          >
            <option value="">{t('allExpiries')}</option>
            {data.expiries.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('metric')}
          <select
            aria-label={t('metric')}
            value={metric}
            onChange={(e) => setMetric(e.target.value as ActivityMetric)}
          >
            <option value="volume">{t('volume')}</option>
            <option value="oi">{t('oi')}</option>
          </select>
        </label>
        <label>
          {t('units')}
          <select
            aria-label={t('units')}
            value={unit}
            onChange={(e) => setUnit(e.target.value as ActivityUnit)}
          >
            <option value="contracts">{t('contracts')}</option>
            <option value="usd">{t('notional')}</option>
          </select>
        </label>
        <span className={styles.legend}>
          <i className={styles.callDot} />
          {t('calls')}
          <i className={styles.putDot} />
          {t('puts')}
        </span>
      </div>
      <div className={styles.coverage} role="status">
        {t('coverage', observed)}
        {partial && <span>{t('partial')}</span>}
        <span>
          {t('observations', {
            volume: data.lastVolumeAt == null ? '—' : `${TIME.format(data.lastVolumeAt)} ET`,
            oi: data.lastOiAt == null ? '—' : `${TIME.format(data.lastOiAt)} ET`,
          })}
        </span>
        {data.deferredExpiries.length > 0 && (
          <span>{t('deferred', { n: data.deferredExpiries.length })}</span>
        )}
        {!data.streaming && <span>{t('offline')}</span>}
        {query.error && <span>{query.error.message}</span>}
      </div>
      <div className={styles.kpis}>
        {kpis.map(([label, value]) => (
          <div key={label} className={styles.kpi}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {data.byExpiry.length === 0 ? (
        <p className={styles.empty}>{t('empty')}</p>
      ) : (
        <ActivityPanels data={data} metric={metric} unit={unit} onSelectExpiry={setExpiry} />
      )}
      <p className={styles.note}>
        {unit === 'usd' && `${t('notionalNote')} `}
        {t('oiNote')}
      </p>
      <ParityPanel
        key={expiry}
        underlying={underlying}
        spot={data.spot}
        expiries={data.expiries}
        initialExpiry={expiry || data.expiries[0] || ''}
      />
    </div>
  );
}
