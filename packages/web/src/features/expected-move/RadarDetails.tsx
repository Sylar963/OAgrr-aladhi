import type {
  ExpectedMoveResponse,
  ExpectedMoveSession,
  ExpectedStraddleResponse,
} from '@oggregator/protocol';
import { fmtIv, fmtPrice } from '@lib/format';
import { useT } from '@lib/i18n';
import { useEffect, useState } from 'react';
import { messages } from './i18n';
import { radarMessages } from './radar-i18n';
import { radarPrice, radarTime } from './RadarChart';
import type { ExpectedMoveSettings } from './settings';
import styles from './ExpectedMovePanel.module.css';

export const percent = (value: number | null | undefined, signed = false) =>
  value == null ? '—' : `${signed && value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;

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
        const next = draft.trim() === '' ? Number.NaN : Number(draft);
        if (Number.isFinite(next) && next >= min && next <= max) onCommit(next);
        else setDraft(String(value));
      }}
    />
  );
}

export default function RadarDetails({
  report,
  session,
  quote,
  settings,
  update,
  replay,
  scrubbing,
  observedAt,
}: {
  report: ExpectedMoveResponse;
  session: ExpectedMoveSession | null;
  quote: ExpectedStraddleResponse | null;
  settings: ExpectedMoveSettings;
  update: (patch: Partial<ExpectedMoveSettings>) => void;
  replay: boolean;
  scrubbing: boolean;
  observedAt: number | null;
}) {
  const t = useT(messages);
  const r = useT(radarMessages);
  const price = (value: number | null | undefined) => radarPrice(value, report.underlying);
  return (
    <details className={styles.drawer}>
      <summary>{r('settings')}</summary>
      <div className={styles.controls}>
        <label>
          {t('moveThreshold')}
          <NumericSetting
            value={settings.moveAlertRatio}
            min={0.25}
            max={10}
            step={0.25}
            onCommit={(moveAlertRatio) => update({ moveAlertRatio })}
          />
        </label>
        <label>
          {t('premiumThreshold')}
          <NumericSetting
            value={settings.premiumAlertPercent}
            min={1}
            max={1000}
            onCommit={(premiumAlertPercent) => update({ premiumAlertPercent })}
          />
        </label>
        <label>
          {t('days')}
          <select
            aria-label={t('days')}
            value={settings.historyDays}
            onChange={(e) =>
              update({ historyDays: Number(e.target.value) as ExpectedMoveSettings['historyDays'] })
            }
          >
            {[7, 14, 30].map((days) => (
              <option key={days}>{days}</option>
            ))}
          </select>
        </label>
      </div>
      <dl className={styles.dataGrid}>
        <div>
          <dt>{t('opening')}</dt>
          <dd>
            ±{percent(session?.expectedFraction)} · {price(session?.expectedUsd)}
          </dd>
        </div>
        <div>
          <dt>{t('live')}</dt>
          <dd>
            {replay || report.liveIv == null
              ? '—'
              : `±${percent(report.liveIv / Math.sqrt(report.periodsPerYear))}`}
          </dd>
        </div>
        <div>
          <dt>
            {report.index} · {r('open')}
          </dt>
          <dd>{fmtIv(session?.openingIv)}</dd>
        </div>
        <div>
          <dt>
            {report.index} · {r('live')}
          </dt>
          <dd>{fmtIv(replay ? null : report.liveIv)}</dd>
        </div>
        <div>
          <dt>{t('range')}</dt>
          <dd>{percent(scrubbing ? null : session?.rangeFraction)}</dd>
        </div>
        <div>
          <dt>{t('dailyStraddle')}</dt>
          <dd>{price(session?.approximateStraddleUsd)}</dd>
        </div>
        <div>
          <dt>{r('open')}</dt>
          <dd>{price(session?.open)}</dd>
        </div>
        <div>
          <dt>{t('updated')}</dt>
          <dd>{observedAt == null ? '—' : `${radarTime(observedAt)} UTC`}</dd>
        </div>
      </dl>
      {quote && (
        <dl className={styles.dataGrid}>
          <div>
            <dt>{t('buy')}</dt>
            <dd>
              {price(quote.ask)} · {t('size')} {fmtPrice(quote.askSize)}
            </dd>
          </div>
          <div>
            <dt>{t('sell')}</dt>
            <dd>
              {price(quote.bid)} · {t('size')} {fmtPrice(quote.bidSize)}
            </dd>
          </div>
          <div>
            <dt>{t('mid')}</dt>
            <dd>{price(quote.mid)}</dd>
          </div>
          <div>
            <dt>
              {t('indexModel')} · {fmtIv(quote.indexIv)}
            </dt>
            <dd>
              {price(quote.indexModel)} · {percent(quote.indexDifferenceFraction, true)}
            </dd>
          </div>
          <div>
            <dt>
              {t('surfaceModel')} · {fmtIv(quote.surfaceIv)}
            </dt>
            <dd>
              {price(quote.surfaceModel)} · {percent(quote.surfaceDifferenceFraction, true)}
            </dd>
          </div>
          <div>
            <dt>{t('referenceStrikes')}</dt>
            <dd>{quote.surfaceStrikes.map(fmtPrice).join(' / ') || '—'}</dd>
          </div>
        </dl>
      )}
      <details
        open={settings.showHistory}
        onToggle={(e) => {
          if (e.currentTarget.open !== settings.showHistory)
            update({ showHistory: e.currentTarget.open });
        }}
      >
        <summary>{t('history')}</summary>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                {(['date', 'expected', 'realized', 'ratio', 'outcome'] as const).map((label) => (
                  <th key={label}>{t(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.history.map((s) => (
                <tr key={s.startMs}>
                  <td>{new Date(s.startMs).toISOString().slice(0, 10)}</td>
                  <td>{percent(s.expectedFraction)}</td>
                  <td>{percent(s.absoluteReturnFraction)}</td>
                  <td>{s.moveRatio?.toFixed(2) ?? '—'}×</td>
                  <td>
                    {t(
                      s.classification === 'at-benchmark'
                        ? 'equal'
                        : s.classification === 'in-progress'
                          ? 'inProgress'
                          : s.classification,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={styles.note}>{t('benchmarkNote', { periods: report.periodsPerYear })}</p>
      <p className={styles.note}>{t(report.underlying === 'SPX' ? 'spxNote' : 'cryptoNote')}</p>
      <p className={styles.note}>{t('pricingNote')}</p>
      <p className={styles.note}>
        {r('coneNote')} {r('elapsedNote')} {r('expiryNote')}
      </p>
      <p className={styles.note}>
        <a
          href="https://insights.deribit.com/education/expected-move-calculations-and-visual/"
          target="_blank"
          rel="noreferrer"
        >
          Deribit: expected move
        </a>
      </p>
    </details>
  );
}
