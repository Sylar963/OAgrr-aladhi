import { ExpectedMoveAssetSchema, type ExpectedMoveAsset } from '@oggregator/protocol';
import { fmtIv, fmtPrice } from '@lib/format';
import { useT } from '@lib/i18n';
import { VENUE_LIST } from '@lib/venue-meta';
import { selectActiveLayoutId, useAppStore, useMarket } from '@stores/app-store';
import { useEffect, useMemo, useState } from 'react';
import { messages } from './i18n';
import { radarMessages } from './radar-i18n';
import {
  buildRadarTrail,
  expiryCone,
  liveCone,
  openingCone,
  radarEvents,
  radarIndexAtTime,
  radarRatios,
  straddleLevels,
} from './radar-model';
import {
  useExpectedMove,
  useExpectedMoveExpiries,
  useExpectedStraddle,
  useRadarPath,
} from './queries';
import RadarChart, { radarPrice, radarTime } from './RadarChart';
import RadarDetails, { percent } from './RadarDetails';
import { DEFAULT_SETTINGS, useExpectedMoveSettings, type ExpectedMoveSettings } from './settings';
import styles from './ExpectedMovePanel.module.css';

type Update = (patch: Partial<ExpectedMoveSettings>) => void;

function AssetControl({ settings, update }: { settings: ExpectedMoveSettings; update: Update }) {
  const t = useT(messages);
  return (
    <label className={styles.compactControl}>
      <span>{t('asset')}</span>
      <select
        aria-label={t('asset')}
        value={settings.asset}
        onChange={(e) =>
          update({ asset: e.target.value as ExpectedMoveSettings['asset'], expiry: '' })
        }
      >
        <option value="workspace">{t('workspace')}</option>
        {ExpectedMoveAssetSchema.options.map((asset) => (
          <option key={asset}>{asset}</option>
        ))}
      </select>
    </label>
  );
}

export default function ExpectedMovePanel() {
  const t = useT(messages);
  const r = useT(radarMessages);
  const layoutId = useAppStore(selectActiveLayoutId);
  const workspaceAsset = useMarket((m) => m.underlying);
  const settings = useExpectedMoveSettings((s) => s.panels[layoutId] ?? DEFAULT_SETTINGS);
  const save = useExpectedMoveSettings((s) => s.update);
  const update: Update = (patch) => save(layoutId, patch);
  const parsed = ExpectedMoveAssetSchema.safeParse(
    settings.asset === 'workspace' ? workspaceAsset.replace(/_USDC$/, '') : settings.asset,
  );
  const asset = parsed.success ? parsed.data : null;
  const anchor = asset === 'SPX' ? 'cash' : settings.anchor;
  const query = useExpectedMove(asset, anchor, settings.historyDays);
  return (
    <section className={styles.panel} aria-label={t('title')}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>VOLATILITY / RADAR</span>
          <h2>{r('radar')}</h2>
        </div>
        <AssetControl settings={settings} update={update} />
      </header>
      {asset == null ? (
        <p className={styles.note}>{t('unsupported')}</p>
      ) : (
        <RadarWorkspace
          key={`${layoutId}:${asset}:${anchor}`}
          asset={asset}
          query={query}
          settings={settings}
          update={update}
        />
      )}
    </section>
  );
}

function RadarWorkspace({
  asset,
  query,
  settings,
  update,
}: {
  asset: ExpectedMoveAsset;
  query: ReturnType<typeof useExpectedMove>;
  settings: ExpectedMoveSettings;
  update: Update;
}) {
  const t = useT(messages);
  const r = useT(radarMessages);
  const report = query.data;
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const session =
    selectedStart == null
      ? (report?.current ?? report?.history[0] ?? null)
      : (report?.history.find((s) => s.startMs === selectedStart) ?? null);
  const path = useRadarPath(asset, session);
  const nowMs = Date.now();
  const points = useMemo(
    () =>
      session == null
        ? []
        : buildRadarTrail(
            session,
            path.data?.candles ?? [],
            path.data?.resolutionMs ?? 300_000,
            Date.now(),
            { pathAsOfMs: path.data?.asOfMs ?? 0, snapshotAsOfMs: report?.generatedAt ?? 0 },
          ),
    [session, path.data, report?.generatedAt],
  );
  const replay = cursorTime != null || session?.complete === true || selectedStart != null;
  const horizon = replay ? 'day' : settings.horizon;
  const venue = asset === 'SPX' ? 'tastytrade' : settings.venue;
  const needQuotes = !replay && (settings.showStraddle || horizon === 'expiry');
  const expiries = useExpectedMoveExpiries(asset, venue, needQuotes);
  const expiry = expiries.data?.includes(settings.expiry)
    ? settings.expiry
    : (expiries.data?.[0] ?? '');
  const straddle = useExpectedStraddle(asset, venue, expiry, needQuotes);
  const candidate = straddle.data;
  const quote =
    needQuotes &&
    !straddle.isError &&
    candidate?.status === 'available' &&
    candidate.underlying === asset &&
    candidate.expiry === expiry &&
    candidate.venue === venue &&
    candidate.quoteAsOfMs != null &&
    nowMs - candidate.quoteAsOfMs <= 90_000 &&
    candidate.quoteAsOfMs <= nowMs + 5000 &&
    candidate.expiryTs != null &&
    candidate.expiryTs > nowMs
      ? candidate
      : null;
  const selectedIndex =
    cursorTime == null ? Math.max(0, points.length - 1) : radarIndexAtTime(points, cursorTime);
  const visible = cursorTime == null ? points : points.slice(0, selectedIndex + 1);
  const point = visible.at(-1) ?? null;
  const opening = session == null ? null : openingCone(session);
  const primary =
    horizon === 'day' ? opening : quote ? expiryCone(quote, settings.reference) : null;
  const stale = report != null && (query.isError || nowMs - report.generatedAt > 120_000);
  const fresh =
    !replay &&
    !stale &&
    session?.coverage === 'complete' &&
    nowMs - session.priceAsOfMs <= 120_000 &&
    !path.isError &&
    point != null &&
    nowMs - point.time <= 120_000;
  const projected =
    fresh &&
    horizon === 'day' &&
    settings.showLiveCone &&
    report &&
    session &&
    point &&
    report.liveIvAsOfMs != null &&
    nowMs - report.liveIvAsOfMs <= 120_000
      ? liveCone(session, point, report.liveIv, report.periodsPerYear)
      : null;
  const ratios = session && point ? radarRatios(session, point) : null;
  const events = horizon === 'day' ? radarEvents(visible, opening, settings.showTwoSigma) : [];
  const sigmaAvailable = (session?.expectedUsd ?? 0) > 0 || primary?.shape === 'lognormal';
  const chartUnit =
    settings.chartUnit === 'sigma' && !sigmaAvailable ? 'price' : settings.chartUnit;
  const premium =
    quote == null
      ? null
      : settings.reference === 'surface'
        ? quote.surfaceDifferenceFraction
        : quote.indexDifferenceFraction;
  const selectedIv =
    quote == null ? null : settings.reference === 'surface' ? quote.surfaceIv : quote.indexIv;
  const modelPrice =
    quote == null ? null : settings.reference === 'surface' ? quote.surfaceModel : quote.indexModel;
  const choose = (start: number | null) => {
    setSelectedStart(start);
    setCursorTime(null);
    setPlaying(false);
  };
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setCursorTime((current) => {
          const next = current == null ? 0 : radarIndexAtTime(points, current) + 1;
          return points[Math.min(next, Math.max(0, points.length - 1))]?.time ?? null;
        }),
      150,
    );
    return () => clearInterval(timer);
  }, [playing, points]);
  useEffect(() => {
    if (playing && cursorTime != null && selectedIndex >= points.length - 1) setPlaying(false);
  }, [cursorTime, playing, selectedIndex, points.length]);
  useEffect(() => {
    setCursorTime(null);
    setPlaying(false);
  }, [session?.startMs]);
  useEffect(() => {
    if (
      report &&
      selectedStart != null &&
      !report.history.some((day) => day.startMs === selectedStart)
    ) {
      setSelectedStart(null);
      setCursorTime(null);
      setPlaying(false);
    }
  }, [report, selectedStart]);
  const outcome =
    ratios?.pace == null
      ? t('unavailable')
      : r(ratios.pace >= 2 ? 'outer' : ratios.pace >= 1 ? 'outside' : 'inside');
  const ratioText = (value: number | null | undefined) =>
    value == null ? '—' : `${value.toFixed(2)}×`;
  const showExpiry =
    settings.showStraddle &&
    quote?.expiryTs != null &&
    session != null &&
    quote.expiryTs > session.endMs &&
    horizon === 'day';

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label={r('horizon')}>
          <button aria-pressed={horizon === 'day'} onClick={() => update({ horizon: 'day' })}>
            {r('day')}
          </button>
          <button
            aria-pressed={horizon === 'expiry'}
            disabled={replay}
            onClick={() => update({ horizon: 'expiry' })}
          >
            {r('toExpiry')}
          </button>
        </div>
        <select
          className={styles.unitSelect}
          aria-label={r('unit')}
          value={chartUnit}
          onChange={(e) =>
            update({ chartUnit: e.target.value as ExpectedMoveSettings['chartUnit'] })
          }
        >
          {(['price', 'percent', 'sigma'] as const).map((unit) => (
            <option key={unit} value={unit} disabled={unit === 'sigma' && !sigmaAvailable}>
              {r(unit)}
            </option>
          ))}
        </select>
        {asset !== 'SPX' && (
          <select
            aria-label={t('session')}
            value={settings.anchor}
            onChange={(e) => update({ anchor: e.target.value as ExpectedMoveSettings['anchor'] })}
          >
            <option value="utc0">{t('utc0')}</option>
            <option value="utc8">{t('utc8')}</option>
          </select>
        )}
        {asset === 'SPX' && <span className={styles.note}>{t('cash')}</span>}
        <span className={styles.state} data-stress={(ratios?.pace ?? 0) >= 1}>
          <i />
          {!replay && !fresh ? t('unavailable') : outcome}
        </span>
      </div>
      <div className={styles.readouts}>
        <div title={r('dailyHint')}>
          <span>{r('dailyMove')}</span>
          <strong>{ratioText(ratios?.daily)}</strong>
          <small>{r('dailyDetail')}</small>
        </div>
        <div title={r('paceHint')} data-stress={(ratios?.pace ?? 0) >= 1}>
          <span>{r('pace')}</span>
          <strong>{ratioText(ratios?.pace)}</strong>
          <small>{r('paceDetail')}</small>
        </div>
        <div
          title={r('premiumHint')}
          data-stress={premium != null && Math.abs(premium * 100) >= settings.premiumAlertPercent}
        >
          <span>{r('premium')}</span>
          <strong>{percent(premium, true)}</strong>
          <small>
            {needQuotes ? (
              r(settings.reference === 'surface' ? 'surface' : 'index')
            ) : replay ? (
              r('replay')
            ) : (
              <button className={styles.textButton} onClick={() => update({ showStraddle: true })}>
                {r('enableStraddle')}
              </button>
            )}
          </small>
        </div>
      </div>
      <div className={styles.overlayBar} role="group" aria-label={r('overlays')}>
        <span className={styles.legend}>
          <i className={styles.tealSwatch} />
          {horizon === 'day' ? r('openingCone') : r('sameHorizon')}
        </span>
        <button
          aria-pressed={settings.showTwoSigma}
          onClick={() => update({ showTwoSigma: !settings.showTwoSigma })}
        >
          {r('twoSigma')}
        </button>
        <button
          aria-pressed={horizon === 'day' && !replay && settings.showLiveCone}
          disabled={replay || horizon !== 'day'}
          onClick={() => update({ showLiveCone: !settings.showLiveCone })}
        >
          {r('liveCone')}
        </button>
        <button
          aria-pressed={!replay && settings.showStraddle}
          disabled={replay}
          onClick={() => update({ showStraddle: !settings.showStraddle })}
        >
          {t('straddle')}
        </button>
        <span className={styles.legend}>
          <i className={styles.whiteSwatch} />
          {r('spot')}
        </span>
      </div>
      {query.isPending && (
        <p role="status" className={styles.note}>
          {t('loading')}
        </p>
      )}
      {query.isError && (
        <p role="status" className={styles.warning}>
          {t('failed')} <button onClick={() => void query.refetch()}>{t('retry')}</button>
        </p>
      )}
      {stale && <p className={styles.warning}>{t('stale')}</p>}
      {session && (
        <>
          <div className={styles.chartSummary}>
            <span>
              {asset} / {report?.index} · {new Date(session.startMs).toISOString().slice(0, 10)}
            </span>
            <span>
              {horizon === 'day'
                ? `1σ ±${percent(session.expectedFraction)} · ${fmtIv(session.openingIv)} IV`
                : `${fmtIv(selectedIv)} IV · ${expiry || '—'}`}
            </span>
          </div>
          <RadarChart
            key={`${asset}:${session.startMs}`}
            asset={asset}
            session={session}
            points={visible}
            primary={primary}
            live={projected}
            quote={quote}
            settings={{ ...settings, horizon, chartUnit }}
            events={events}
            replay={replay}
            fresh={fresh}
          />
          <div className={styles.replayBar}>
            <button
              aria-label={playing ? r('pause') : r('play')}
              disabled={points.length < 2}
              onClick={() => {
                if (playing) setPlaying(false);
                else {
                  setCursorTime(
                    points[selectedIndex >= points.length - 1 ? 0 : selectedIndex]?.time ?? null,
                  );
                  setPlaying(true);
                }
              }}
            >
              {playing ? 'Ⅱ' : '▶'}
            </button>
            <input
              aria-label={r('replayTime')}
              type="range"
              min={0}
              max={Math.max(0, points.length - 1)}
              value={selectedIndex}
              onChange={(e) => {
                setCursorTime(points[Number(e.target.value)]?.time ?? null);
                setPlaying(false);
              }}
            />
            <span>{point ? radarTime(point.time) : '—'} UTC</span>
            <button aria-pressed={!replay} onClick={() => choose(null)}>
              {r('live')}
            </button>
          </div>
          <div className={styles.chartFoot}>
            <span>{r('coneNote')}</span>
            <span>
              {path.data?.resolutionMs === 3_600_000 ? '1h' : '5m'} · {r('observed')}{' '}
              {radarTime(session.priceAsOfMs)} UTC
            </span>
          </div>
          {path.isPending && (
            <p className={styles.note} role="status">
              {r('pathLoading')}
            </p>
          )}
          {(path.isError || !path.data?.candles.length) && !path.isPending && (
            <p className={styles.note}>{r('noPath')}</p>
          )}
          {session.openingIv == null && <p className={styles.warning}>{r('missingBenchmark')}</p>}
          {replay && <p className={styles.replayNote}>{r('noHistoryQuotes')}</p>}
          {!replay && (session.coverage === 'partial' || !fresh) && (
            <p className={styles.note}>{t('partial')}</p>
          )}
          {!replay && horizon === 'day' && settings.showLiveCone && !projected && (
            <p className={styles.note}>{r('liveHidden')}</p>
          )}
          {!replay && horizon === 'expiry' && !primary && (
            <p className={styles.note}>{r('quotesNeeded')}</p>
          )}
          {fresh && ratios?.daily != null && ratios.daily >= settings.moveAlertRatio && (
            <p className={styles.alert} role="status">
              {t('dailyAlert', { ratio: settings.moveAlertRatio })}
            </p>
          )}
        </>
      )}
      {!session && report && <p className={styles.note}>{t('noSession')}</p>}

      {needQuotes && (
        <div className={styles.quotePanel}>
          <div className={styles.controls}>
            {asset !== 'SPX' && (
              <label>
                {t('venue')}
                <select
                  aria-label={t('venue')}
                  value={settings.venue}
                  onChange={(e) =>
                    update({ venue: e.target.value as ExpectedMoveSettings['venue'], expiry: '' })
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
                {expiries.data?.map((date) => (
                  <option key={date}>{date}</option>
                ))}
              </select>
            </label>
            <label>
              {r('reference')}
              <select
                aria-label={r('reference')}
                value={settings.reference}
                onChange={(e) =>
                  update({ reference: e.target.value as ExpectedMoveSettings['reference'] })
                }
              >
                <option value="surface">{r('surface')}</option>
                <option value="index">{r('index')}</option>
              </select>
            </label>
          </div>
          {quote ? (
            <>
              <div className={styles.quoteSummary}>
                <span>
                  {r('strike')} <b>{fmtPrice(quote.strike)}</b>
                </span>
                <span>
                  {t('buy')} <b>{radarPrice(quote.ask, asset)}</b>
                </span>
                <span>
                  {t('sell')} <b>{radarPrice(quote.bid, asset)}</b>
                </span>
                <span>
                  {r('reference')} <b>{radarPrice(modelPrice, asset)}</b> · {fmtIv(selectedIv)}
                </span>
              </div>
              {showExpiry ? (
                <button
                  className={styles.textButton}
                  title={r('outsideHorizon')}
                  onClick={() => update({ horizon: 'expiry' })}
                >
                  {r('expiryLevels')}
                </button>
              ) : (
                settings.showStraddle && (
                  <div className={styles.breakEvens}>
                    <span>{r('beforeFees')}</span>
                    {straddleLevels(quote).map((levels) => (
                      <span
                        key={levels.kind}
                        className={levels.kind === 'buy' ? styles.buyLegend : styles.sellLegend}
                      >
                        {r(levels.kind === 'buy' ? 'buyBe' : 'sellBe')}{' '}
                        {radarPrice(levels.lower, asset)} / {radarPrice(levels.upper, asset)}
                      </span>
                    ))}
                  </div>
                )
              )}
            </>
          ) : (
            <p className={styles.note}>
              {expiries.isError || straddle.isError ? t('straddleFailed') : t('quoteUnavailable')}
            </p>
          )}
        </div>
      )}

      {report && (
        <>
          <div className={styles.sessionStrip} aria-label={r('sessions')}>
            {report.current && (
              <button
                aria-pressed={selectedStart == null && !session?.complete}
                onClick={() => choose(null)}
              >
                <span>{r('current')}</span>
                <strong>{ratioText(report.current.moveRatio)}</strong>
              </button>
            )}
            {report.history.map((day) => (
              <button
                key={day.startMs}
                aria-pressed={session?.startMs === day.startMs}
                data-stress={day.classification === 'large'}
                onClick={() => {
                  choose(day.startMs);
                  update({ horizon: 'day' });
                }}
              >
                <span>{new Date(day.startMs).toISOString().slice(5, 10)}</span>
                <strong>{ratioText(day.moveRatio)}</strong>
              </button>
            ))}
          </div>
          <RadarDetails
            report={report}
            session={session}
            quote={quote}
            settings={settings}
            update={update}
            replay={replay}
            scrubbing={cursorTime != null && selectedIndex < points.length - 1}
            observedAt={point?.time ?? null}
          />
        </>
      )}
    </>
  );
}
