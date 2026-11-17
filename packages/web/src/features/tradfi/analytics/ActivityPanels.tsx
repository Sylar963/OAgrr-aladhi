import { fmtStrike } from '@lib/format';
import { useT } from '@lib/i18n';
import type { OptionsActivity, TradfiAnalyticsResponse } from '@oggregator/protocol';
import { TRADFI_ANALYTICS_HEATMAP_STRIKES } from '@oggregator/protocol';
import { type CSSProperties, useMemo } from 'react';
import styles from './Analytics.module.css';
import {
  type ActivityMetric,
  type ActivityUnit,
  activityValue,
  formatActivity,
  formatRatio,
  totalActivity,
} from './format';
import { analyticsMessages } from './messages';

interface Props {
  data: TradfiAnalyticsResponse;
  metric: ActivityMetric;
  unit: ActivityUnit;
  onSelectExpiry: (expiry: string) => void;
}

export function ActivityPanels({ data, metric, unit, onSelectExpiry }: Props) {
  const t = useT(analyticsMessages);
  const strikes = useMemo(
    () =>
      [...data.byStrike]
        .sort(
          (a, b) => (totalActivity(b, metric, unit) ?? -1) - (totalActivity(a, metric, unit) ?? -1),
        )
        .slice(0, TRADFI_ANALYTICS_HEATMAP_STRIKES)
        .sort((a, b) => a.strike - b.strike),
    [data.byStrike, metric, unit],
  );
  const cells = useMemo(
    () => new Map(data.cells.map((c) => [`${c.expiry}:${c.strike}`, c])),
    [data.cells],
  );
  const maxCell = data.cells.reduce(
    (max, c) => Math.max(max, totalActivity(c, metric, unit) ?? 0),
    1,
  );
  const totalVolume = totalActivity(data.summary, 'volume', unit);

  return (
    <>
      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>{t('byTenor')}</h2>
            <span>{t(metric === 'volume' ? 'volume' : 'oi')}</span>
          </div>
          <ActivityBars
            rows={data.byExpiry.map((r) => ({
              id: r.expiry,
              label: r.expiry,
              activity: r,
              select: () => onSelectExpiry(r.expiry),
            }))}
            metric={metric}
            unit={unit}
          />
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>{t('byStrike')}</h2>
            <span>{data.spot == null ? '—' : `SPOT ${fmtStrike(data.spot)}`}</span>
          </div>
          <ActivityBars
            rows={strikes.map((r) => ({
              id: String(r.strike),
              label: fmtStrike(r.strike),
              activity: r,
            }))}
            metric={metric}
            unit={unit}
          />
          <p className={styles.note}>{t('strikeNote')}</p>
        </section>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>{t('heatmap')}</h2>
          <span>{t(metric === 'volume' ? 'volume' : 'oi')}</span>
        </div>
        <p className={styles.note}>{t('heatmapNote')}</p>
        <div className={styles.tableScroll}>
          <table className={styles.heatmap}>
            <thead>
              <tr>
                <th scope="col">{t('expiry')}</th>
                {strikes.map((r) => (
                  <th scope="col" key={r.strike}>
                    {fmtStrike(r.strike)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.byExpiry.map((row) => (
                <tr key={row.expiry}>
                  <th scope="row">{row.expiry}</th>
                  {strikes.map(({ strike }) => {
                    const cell = cells.get(`${row.expiry}:${strike}`);
                    const value = cell ? totalActivity(cell, metric, unit) : null;
                    const intensity =
                      value == null || value === 0 ? 0 : 10 + 75 * Math.sqrt(value / maxCell);
                    return (
                      <td key={strike}>
                        <button
                          type="button"
                          data-intense={intensity >= 45}
                          onClick={() => onSelectExpiry(row.expiry)}
                          style={{ '--heat': `${intensity}%` } as CSSProperties}
                          title={`${row.expiry} / ${fmtStrike(strike)} · ${t('calls')}: ${formatActivity(cell ? activityValue(cell.call, metric, unit) : null, unit)} · ${t('puts')}: ${formatActivity(cell ? activityValue(cell.put, metric, unit) : null, unit)}`}
                        >
                          {formatActivity(value, unit)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>{t('tenorTable')}</h2>
          <span>{t(unit === 'usd' ? 'notional' : 'contracts')}</span>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {(
                  [
                    'expiry',
                    'dte',
                    'callVolume',
                    'putVolume',
                    'share',
                    'pcVolume',
                    'callOi',
                    'putOi',
                    'pcOi',
                  ] as const
                ).map((key) => (
                  <th scope="col" key={key}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.byExpiry.map((row) => {
                const volume = totalActivity(row, 'volume', unit);
                return (
                  <tr key={row.expiry}>
                    <th scope="row">
                      <button
                        className={styles.textButton}
                        type="button"
                        onClick={() => onSelectExpiry(row.expiry)}
                      >
                        {row.expiry}
                      </button>
                    </th>
                    <td>{row.dte.toFixed(1)}</td>
                    <td>{formatActivity(activityValue(row.call, 'volume', unit), unit)}</td>
                    <td>{formatActivity(activityValue(row.put, 'volume', unit), unit)}</td>
                    <td>
                      {volume != null && totalVolume != null && totalVolume > 0
                        ? `${((100 * volume) / totalVolume).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td>{formatRatio(row.putCallVolumeRatio)}</td>
                    <td>{formatActivity(activityValue(row.call, 'oi', unit), unit)}</td>
                    <td>{formatActivity(activityValue(row.put, 'oi', unit), unit)}</td>
                    <td>{formatRatio(row.putCallOiRatio)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

interface BarRow {
  id: string;
  label: string;
  activity: OptionsActivity;
  select?: () => void;
}

function ActivityBars({
  rows,
  metric,
  unit,
}: {
  rows: BarRow[];
  metric: ActivityMetric;
  unit: ActivityUnit;
}) {
  const t = useT(analyticsMessages);
  const max = Math.max(1, ...rows.map((r) => totalActivity(r.activity, metric, unit) ?? 0));
  return (
    <div className={styles.barRows}>
      {rows.map((row) => {
        const call = activityValue(row.activity.call, metric, unit);
        const put = activityValue(row.activity.put, metric, unit);
        return (
          <div key={row.id} className={styles.barRow}>
            {row.select ? (
              <button type="button" className={styles.textButton} onClick={row.select}>
                {row.label}
              </button>
            ) : (
              <span>{row.label}</span>
            )}
            <div
              className={styles.barTrack}
              role="img"
              aria-label={`${row.label} · ${t('calls')}: ${formatActivity(call, unit)} · ${t('puts')}: ${formatActivity(put, unit)}`}
            >
              <span className={styles.callBar} style={{ width: `${(100 * (call ?? 0)) / max}%` }} />
              <span className={styles.putBar} style={{ width: `${(100 * (put ?? 0)) / max}%` }} />
            </div>
            <span>{formatActivity(totalActivity(row.activity, metric, unit), unit)}</span>
          </div>
        );
      })}
    </div>
  );
}
