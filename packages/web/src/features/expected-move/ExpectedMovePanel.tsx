import { ExpectedMoveAssetSchema, type ExpectedMoveSession } from '@oggregator/protocol';
import { fmtIv, fmtPrice, fmtUsdPrice } from '@lib/format';
import { useT } from '@lib/i18n';
import { VENUE_LIST } from '@lib/venue-meta';
import { selectActiveLayoutId, useAppStore, useMarket } from '@stores/app-store';
import { type ReactNode, useEffect, useState } from 'react';
import { messages } from './i18n';
import { useExpectedMove, useExpectedMoveExpiries, useExpectedStraddle } from './queries';
import { DEFAULT_SETTINGS, useExpectedMoveSettings } from './settings';
import styles from './ExpectedMovePanel.module.css';

const percent = (v: number | null | undefined, signed = false) =>
  v == null ? '—' : `${signed && v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
const date = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const observed = (ts: number) => `${new Date(ts).toISOString().slice(11, 16)} UTC`;

function Metric({
  label,
  children,
  detail,
}: {
  label: string;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{children}</strong>
      {detail != null && <small>{detail}</small>}
    </div>
  );
}

function NumericSetting({
  value,
  min,
  max,
  step = 1,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = draft.trim() === '' ? Number.NaN : Number(draft);
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onCommit(parsed);
        else setDraft(String(value));
      }}
    />
  );
}

export default function ExpectedMovePanel() {
  const t = useT(messages);
  const layoutId = useAppStore(selectActiveLayoutId);
  const workspaceAsset = useMarket((m) => m.underlying);
  const settings = useExpectedMoveSettings((s) => s.panels[layoutId] ?? DEFAULT_SETTINGS);
  const updateSettings = useExpectedMoveSettings((s) => s.update);
  const update = (patch: Parameters<typeof updateSettings>[1]) => updateSettings(layoutId, patch);
  const selected =
    settings.asset === 'workspace' ? workspaceAsset.replace(/_USDC$/, '') : settings.asset;
  const assetParsed = ExpectedMoveAssetSchema.safeParse(selected);
  const asset = assetParsed.success ? assetParsed.data : null;
  const anchor = asset === 'SPX' ? 'cash' : settings.anchor;
  const venue = asset === 'SPX' ? 'tastytrade' : settings.venue;
  const query = useExpectedMove(asset, anchor, settings.historyDays);
  const expiries = useExpectedMoveExpiries(asset, venue, settings.showStraddle);
  const expiry = expiries.data?.includes(settings.expiry)
    ? settings.expiry
    : (expiries.data?.[0] ?? '');
  const straddle = useExpectedStraddle(asset, venue, expiry, settings.showStraddle);
  const report = query.data;
  const session = report?.current;
  const nowMs = Date.now();
  const stale = report != null && (query.isError || nowMs - report.generatedAt > 120_000);
  const liveExpected =
    report?.liveIv != null ? report.liveIv / Math.sqrt(report.periodsPerYear) : null;
  const priceStale = session != null && !session.complete && nowMs - session.priceAsOfMs > 120_000;
  const moveAlert =
    !stale &&
    !priceStale &&
    session?.coverage === 'complete' &&
    session.moveRatio != null &&
    session.moveRatio >= settings.moveAlertRatio;
  const outcome = (value: ExpectedMoveSession['classification']) =>
    t(value === 'at-benchmark' ? 'equal' : value === 'in-progress' ? 'inProgress' : value);
  const quote = straddle.data;
  const quoteFresh =
    quote != null &&
    !straddle.isError &&
    quote.quoteAsOfMs != null &&
    nowMs - quote.quoteAsOfMs <= 90_000;
  const position =
    session?.expectedUsd != null && session.expectedUsd > 0
      ? Math.max(0, Math.min(100, 50 + (50 * (session.last - session.open)) / session.expectedUsd))
      : 50;
  const difference = (value: number | null) => (
    <>
      {percent(value, true)}
      {value != null && (
        <small
          className={Math.abs(value * 100) >= settings.premiumAlertPercent ? styles.warning : ''}
        >
          {t(
            value * 100 >= settings.premiumAlertPercent
              ? 'rich'
              : value * 100 <= -settings.premiumAlertPercent
                ? 'cheap'
                : 'within',
          )}
        </small>
      )}
    </>
  );

  return (
    <section className={styles.panel} aria-label={t('title')}>
      <header className={styles.header}>
        <h2>{t('title')}</h2>
        <label>
          {t('asset')}
          <select
            aria-label={t('asset')}
            value={settings.asset}
            onChange={(e) => update({ asset: e.target.value as typeof settings.asset, expiry: '' })}
          >
            <option value="workspace">{t('workspace')}</option>
            {['BTC', 'ETH', 'SPX'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        {asset === 'SPX' ? (
          <span className={styles.note}>{t('cash')}</span>
        ) : (
          <label>
            {t('session')}
            <select
              aria-label={t('session')}
              value={settings.anchor}
              onChange={(e) => update({ anchor: e.target.value as typeof settings.anchor })}
            >
              <option value="utc0">{t('utc0')}</option>
              <option value="utc8">{t('utc8')}</option>
            </select>
          </label>
        )}
      </header>

      {asset == null ? (
        <p className={styles.note}>{t('unsupported')}</p>
      ) : (
        <>
          {query.isPending && <p role="status">{t('loading')}</p>}
          {query.isError && (
            <p className={styles.warning} role="status">
              {t('failed')} <button onClick={() => void query.refetch()}>{t('retry')}</button>
            </p>
          )}
          {stale && <p className={styles.warning}>{t('stale')}</p>}
          {report != null && (
            <>
              <div className={styles.source}>
                {asset} / {report.index}{' '}
                <span>{session ? `${date(session.startMs)} · ${t('inProgress')}` : '—'}</span>
              </div>
              <div className={styles.metrics}>
                <Metric
                  label={t('opening')}
                  detail={
                    session == null
                      ? undefined
                      : `${report.index} ${fmtIv(session.openingIv)} · ±${fmtUsdPrice(session.expectedUsd)}`
                  }
                >
                  {session?.expectedFraction == null
                    ? '—'
                    : `±${percent(session.expectedFraction)}`}
                </Metric>
                <Metric label={t('live')} detail={fmtIv(report.liveIv)}>
                  {liveExpected == null ? '—' : `±${percent(liveExpected)}`}
                </Metric>
              </div>
              {session != null ? (
                <>
                  <div className={styles.band} aria-label={t('expected')}>
                    <div className={styles.rail}>
                      <i className={styles.center} />
                      <i className={styles.marker} style={{ left: `${position}%` }} />
                    </div>
                    <div className={styles.boundaries}>
                      <span>{fmtUsdPrice(session.lower)}</span>
                      <span>{fmtUsdPrice(session.open)}</span>
                      <span>{fmtUsdPrice(session.upper)}</span>
                    </div>
                  </div>
                  <div className={styles.metrics}>
                    <Metric label={t('absolute')} detail={t('used')}>
                      {session.moveRatio == null ? '—' : `${session.moveRatio.toFixed(2)}×`}
                    </Metric>
                    <Metric
                      label={t('signed')}
                      detail={`${t('range')}: ${percent(session.rangeFraction)}`}
                    >
                      {percent(session.returnFraction, true)}
                    </Metric>
                  </div>
                  <div className={styles.foot}>
                    <span>
                      {t('dailyStraddle')}: {fmtUsdPrice(session.approximateStraddleUsd)}
                    </span>
                    <span>
                      {t('updated')} {observed(session.priceAsOfMs)}
                    </span>
                  </div>
                  {(session.coverage === 'partial' || priceStale) && (
                    <p className={styles.warning}>{t('partial')}</p>
                  )}
                  {session.openingIv == null && <p className={styles.note}>{t('missingIv')}</p>}
                  {moveAlert && (
                    <p className={styles.alert} role="status">
                      {t('dailyAlert', { ratio: settings.moveAlertRatio })}
                    </p>
                  )}
                </>
              ) : (
                <p className={styles.note}>{t('noSession')}</p>
              )}
            </>
          )}

          <details className={styles.settings}>
            <summary>{t('settings')}</summary>
            <div className={styles.controls}>
              <label>
                {t('moveThreshold')}
                <NumericSetting
                  min={0.25}
                  max={10}
                  step={0.25}
                  value={settings.moveAlertRatio}
                  onCommit={(moveAlertRatio) => update({ moveAlertRatio })}
                />
              </label>
              <label>
                {t('premiumThreshold')}
                <NumericSetting
                  min={1}
                  max={1000}
                  value={settings.premiumAlertPercent}
                  onCommit={(premiumAlertPercent) => update({ premiumAlertPercent })}
                />
              </label>
              <label>
                {t('days')}
                <select
                  aria-label={t('days')}
                  value={settings.historyDays}
                  onChange={(e) =>
                    update({ historyDays: Number(e.target.value) as typeof settings.historyDays })
                  }
                >
                  {[7, 14, 30].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>

          <details
            open={settings.showStraddle}
            onToggle={(e) => {
              if (e.currentTarget.open !== settings.showStraddle)
                update({ showStraddle: e.currentTarget.open });
            }}
          >
            <summary>{t('straddle')}</summary>
            <div className={styles.controls}>
              {asset !== 'SPX' && (
                <label>
                  {t('venue')}
                  <select
                    aria-label={t('venue')}
                    value={settings.venue}
                    onChange={(e) =>
                      update({ venue: e.target.value as typeof settings.venue, expiry: '' })
                    }
                  >
                    {VENUE_LIST.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {t('expiry')}
                <select
                  aria-label={t('expiry')}
                  value={expiry}
                  onChange={(e) => update({ expiry: e.target.value })}
                >
                  {!expiry && <option value="">{t('noExpiry')}</option>}
                  {expiries.data?.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
            </div>
            {expiries.isError || straddle.isError ? (
              <p className={styles.warning}>{t('straddleFailed')}</p>
            ) : expiries.isPending || (expiry && straddle.isPending) ? (
              <p role="status">{t('loading')}</p>
            ) : quote?.status === 'available' && quoteFresh ? (
              <>
                <div className={styles.source}>
                  {venue} · K {fmtPrice(quote.strike)}{' '}
                  <span>
                    {t('updated')} {observed(quote.quoteAsOfMs!)}
                  </span>
                </div>
                <div className={styles.metrics}>
                  <Metric label={t('sell')} detail={`${t('size')}: ${fmtPrice(quote.bidSize)}`}>
                    {fmtUsdPrice(quote.bid)}
                  </Metric>
                  <Metric label={t('buy')} detail={`${t('size')}: ${fmtPrice(quote.askSize)}`}>
                    {fmtUsdPrice(quote.ask)}
                  </Metric>
                </div>
                <div className={styles.comparison}>
                  <div>
                    <span>{t('mid')}</span>
                    <strong>{fmtUsdPrice(quote.mid)}</strong>
                  </div>
                  <div>
                    <span>
                      {t('indexModel')} · {fmtIv(quote.indexIv)}
                    </span>
                    <strong>{fmtUsdPrice(quote.indexModel)}</strong>
                    <span>{t('difference')}</span>
                    <strong>{difference(quote.indexDifferenceFraction)}</strong>
                  </div>
                  <div>
                    <span>
                      {t('surfaceModel')} · {fmtIv(quote.surfaceIv)}
                    </span>
                    <strong>{fmtUsdPrice(quote.surfaceModel)}</strong>
                    <span>{t('difference')}</span>
                    <strong>{difference(quote.surfaceDifferenceFraction)}</strong>
                  </div>
                </div>
                {quote.surfaceModel == null ? (
                  <p className={styles.note}>{t('noSurface')}</p>
                ) : (
                  <p className={styles.note}>
                    {t('referenceStrikes')}: {quote.surfaceStrikes.map(fmtPrice).join(' / ')}
                  </p>
                )}
              </>
            ) : (
              <p className={styles.note}>{t('quoteUnavailable')}</p>
            )}
            <p className={styles.note}>{t('pricingNote')}</p>
          </details>

          <details
            open={settings.showHistory}
            onToggle={(e) => {
              if (e.currentTarget.open !== settings.showHistory)
                update({ showHistory: e.currentTarget.open });
            }}
          >
            <summary>{t('history')}</summary>
            {report?.history.length ? (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      {(['date', 'expected', 'realized', 'ratio', 'outcome'] as const).map(
                        (label) => (
                          <th key={label}>{t(label)}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {report.history.map((s) => (
                      <tr key={s.startMs}>
                        <td>{date(s.startMs)}</td>
                        <td>{percent(s.expectedFraction)}</td>
                        <td>{percent(s.absoluteReturnFraction)}</td>
                        <td>{s.moveRatio == null ? '—' : `${s.moveRatio.toFixed(2)}×`}</td>
                        <td data-outcome={s.classification}>{outcome(s.classification)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.note}>{t('emptyHistory')}</p>
            )}
          </details>

          <details>
            <summary>{t('methodology')}</summary>
            <p className={styles.note}>
              {t('benchmarkNote', { periods: asset === 'SPX' ? 252 : 365 })}
            </p>
            <p className={styles.note}>{t(asset === 'SPX' ? 'spxNote' : 'cryptoNote')}</p>
            <p className={styles.note}>
              <a
                href="https://insights.deribit.com/education/expected-move-calculations-and-visual/"
                target="_blank"
                rel="noreferrer"
              >
                Deribit: expected move
              </a>{' '}
              ·{' '}
              <a
                href="https://www.cboe.com/insights/posts/what-the-vix-and-vix-1-d-indices-attempt-to-measure-and-how-they-differ/"
                target="_blank"
                rel="noreferrer"
              >
                Cboe: VIX horizons
              </a>
            </p>
          </details>
        </>
      )}
    </section>
  );
}
