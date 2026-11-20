import { useEffect, useRef, useState } from 'react';
import {
  PREMIUM_SPIKE_TENORS,
  type PremiumSpikeQuery,
  type PremiumSpikeResponse,
} from '@oggregator/protocol';
import { useMarket } from '@stores/app-store';
import { VENUES, VENUE_LIST } from '@lib/venue-meta';
import { useT } from '@lib/i18n';
import { playTradeCue } from '@lib/audio';
import { usePremiumSpikes } from './queries';
import { messages } from './i18n';
import styles from './PremiumSpikesPanel.module.css';

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const resetClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});
function pair(value: { bid: number; ask: number } | null): string {
  return value ? `${(value.bid * 100).toFixed(2)} / ${(value.ask * 100).toFixed(2)}` : '— / —';
}

export default function PremiumSpikesPanel() {
  const t = useT(messages);
  const workspace = useMarket((m) => m.underlying);
  const [asset, setAsset] = useState('workspace');
  const [venue, setVenue] = useState<PremiumSpikeQuery['venue']>('deribit');
  const candidate = asset === 'workspace' ? workspace.replace(/_USDC$/, '') : asset;
  const underlying = candidate === 'BTC' || candidate === 'ETH' ? candidate : null;
  const query = usePremiumSpikes(underlying, venue);
  return (
    <section className={styles.panel} aria-label={t('title')}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t('eyebrow')}</span>
          <h2>{t('title')}</h2>
        </div>
        <div className={styles.controls}>
          <label>
            {t('asset')}
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              <option value="workspace">
                {t('workspace')} · {workspace}
              </option>
              <option>BTC</option>
              <option>ETH</option>
            </select>
          </label>
          <label>
            {t('venue')}
            <select
              value={venue}
              onChange={(e) => setVenue(e.target.value as PremiumSpikeQuery['venue'])}
            >
              {VENUE_LIST.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <p className={styles.subtitle}>{t('description')}</p>
      {underlying == null ? (
        <p className={styles.empty}>{t('unsupported')}</p>
      ) : query.isError ? (
        <div role="alert" className={styles.empty}>
          {t('failed')}{' '}
          <button type="button" onClick={() => void query.refetch()}>
            {t('retry')}
          </button>
        </div>
      ) : !query.data ? (
        <p role="status" className={styles.empty}>
          {t('loading')}
        </p>
      ) : (
        <Feed key={`${underlying}:${venue}`} report={query.data} />
      )}
    </section>
  );
}

function Feed({ report }: { report: PremiumSpikeResponse }) {
  const t = useT(messages);
  const [tenor, setTenor] = useState('all');
  const [side, setSide] = useState('all');
  const [sound, setSound] = useState(false);
  const seen = useRef<{ session: number; count: number } | null>(null);
  const now = Date.now();
  const sameSession = now >= report.sessionStartMs && now < report.sessionEndMs;
  const fresh =
    sameSession && report.lastScanAt != null && now - report.lastScanAt <= 30_000 && !report.error;
  useEffect(() => {
    const previous = seen.current;
    if (
      sound &&
      fresh &&
      previous?.session === report.sessionStartMs &&
      report.alertCount > previous.count
    ) {
      const latest = report.alerts
        .slice(0, report.alertCount - previous.count)
        .find((a) => (tenor === 'all' || a.tenor === tenor) && (side === 'all' || a.side === side));
      if (latest && latest.timestamp >= Date.now() - 30_000)
        playTradeCue(latest.side === 'put' ? 'sell' : 'buy', 'whale');
    }
    seen.current = { session: report.sessionStartMs, count: report.alertCount };
  }, [report, sound, fresh, tenor, side]);
  const alerts = sameSession
    ? report.alerts.filter(
        (a) => (tenor === 'all' || a.tenor === tenor) && (side === 'all' || a.side === side),
      )
    : [];
  const live = fresh && report.tenors.some((row) => row.sample != null);
  return (
    <>
      <div className={styles.session}>
        <span role="status" className={styles.status} data-live={live}>
          <i />
          {report.error ? t('errors') : !fresh ? t('stale') : live ? t('live') : t('waiting')}
        </span>
        <span>{t('reset', { time: resetClock.format(report.sessionEndMs) })}</span>
      </div>
      <div className={styles.tenors}>
        {report.tenors.map((row) => {
          const sample = fresh ? row.sample : null;
          return (
            <article key={row.tenor} className={styles.tenor}>
              <div className={styles.tenorHeading}>
                <strong>{row.tenor}</strong>
                <span>{row.expiry ?? t('unavailable')}</span>
              </div>
              <div className={styles.actual}>
                {row.expiryTs
                  ? t('days', { days: Math.max(0, (row.expiryTs - now) / 86_400_000).toFixed(0) })
                  : '—'}{' '}
                · 25Δ
              </div>
              {(['put', 'call'] as const).map((right) => (
                <div className={styles.reading} key={right} data-side={right}>
                  <span>{t(right)}</span>
                  <strong>
                    {pair(sample ? (right === 'put' ? sample.putSkew : sample.callSkew) : null)}
                  </strong>
                  <small>{t('dailyHigh')}</small>
                  <small>
                    {pair(sameSession ? (right === 'put' ? row.putHigh : row.callHigh) : null)}
                  </small>
                </div>
              ))}
              <small className={styles.tracking}>
                {sameSession && row.trackingSince
                  ? t('since', { time: clock.format(row.trackingSince) })
                  : t('unseeded')}
              </small>
            </article>
          );
        })}
      </div>
      <div className={styles.feedToolbar}>
        <div className={styles.filters}>
          <label>
            <span className={styles.srOnly}>{t('tenor')}</span>
            <select value={tenor} onChange={(e) => setTenor(e.target.value)}>
              <option value="all">{t('allTenors')}</option>
              {PREMIUM_SPIKE_TENORS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={styles.srOnly}>{t('side')}</span>
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="all">{t('allSides')}</option>
              <option value="put">{t('put')}</option>
              <option value="call">{t('call')}</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          aria-pressed={sound}
          onClick={() => {
            if (!sound) playTradeCue('buy', 'shark', 0.08);
            setSound(!sound);
          }}
        >
          {t('sound')} {sound ? '●' : '○'}
        </button>
      </div>
      <div className={styles.counter}>
        {t('count', { count: sameSession ? report.alertCount : 0 })} · {t('skew')} (vp)
      </div>
      {alerts.length === 0 ? (
        <div className={styles.empty}>
          <strong>{report.alertCount > 0 && sameSession ? t('noMatches') : t('empty')}</strong>
          <p>{t('emptyDetail')}</p>
        </div>
      ) : (
        <div
          className={styles.feed}
          role="log"
          aria-label={t('title')}
          aria-live="polite"
          aria-relevant="additions"
        >
          {alerts.map((alert) => {
            const skew = alert.side === 'put' ? alert.sample.putSkew : alert.sample.callSkew;
            return (
              <article className={styles.event} key={alert.id} data-side={alert.side}>
                <div className={styles.eventTop}>
                  <time dateTime={new Date(alert.timestamp).toISOString()}>
                    {clock.format(alert.timestamp)}
                  </time>
                  <b>{alert.tenor}</b>
                  <strong>{t(alert.side)}</strong>
                  <span>
                    {VENUES[report.venue]?.shortLabel} · {report.underlying}
                  </span>
                </div>
                <div className={styles.eventMain}>
                  <strong>
                    {pair(skew)} <small>vp</small>
                  </strong>
                  <span>
                    {t('previous')}: {pair(alert.previousHigh)}
                  </span>
                  <span>
                    {t('expiry')}: {alert.expiry}
                  </span>
                </div>
                <div className={styles.ivs}>
                  <span>
                    PUT {t('iv')}: {pair(alert.sample.putIv)}%
                  </span>
                  <span>
                    CALL {t('iv')}: {pair(alert.sample.callIv)}%
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <details className={styles.method}>
        <summary>{t('details')}</summary>
        <p>{t('method')}</p>
        <p>{t('coverage')}</p>
        <p>{t('durability')}</p>
      </details>
    </>
  );
}
