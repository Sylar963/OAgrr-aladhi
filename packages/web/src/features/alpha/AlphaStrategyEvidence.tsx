import type { AlphaContextStrategy, AlphaStrategyContext } from '@oggregator/protocol';
import { fmtIv } from '@lib/format';
import { useT } from '@lib/i18n';
import { contextMessages } from './alpha-context-messages';
import styles from './AlphaContextStrip.module.css';

export default function AlphaStrategyEvidence({
  context,
  strategy,
}: {
  context: AlphaStrategyContext | undefined;
  strategy: AlphaContextStrategy;
}) {
  const t = useT(contextMessages);
  if (!context) return <p className={styles.summary}>{t('noData')}</p>;
  const assessment = context.assessments[strategy];
  const p = context.pricing;
  return (
    <div className={styles.evidence}>
      <div className={styles.headline}>
        <strong>{t(strategy)}</strong>
        <span>
          {t(context.horizonSource === 'selected-expiry' ? 'selected' : 'reference', {
            days: context.horizonDays.toFixed(1),
          })}
        </span>
      </div>
      <ul className={styles.reasons}>
        {assessment.reasons.slice(0, 3).map((reason) => (
          <li key={reason}>{t(reason)}</li>
        ))}
      </ul>
      <details>
        <summary>{t('why')}</summary>
        <div className={styles.evidenceGrid}>
          <div>
            <span>{t('pressure')}</span>
            <strong>{t(context.direction)}</strong>
            <small>
              {context.directionBasis === 'unavailable' ? '—' : t(context.directionBasis)}
            </small>
            <small>
              {context.moves
                .map(
                  (move) =>
                    `${move.hours < 24 ? `${move.hours}h` : `${move.hours / 24}D`}: ${move.returnPct.toFixed(1)}% (${move.sigmaUnits.toFixed(1)}σ)`,
                )
                .join(' · ')}
            </small>
          </div>
          <div>
            <span>{t('price')}</span>
            <strong>
              {fmtIv(p.atmIv)} / {fmtIv(p.deliveryLow)}–{fmtIv(p.deliveryHigh)}
            </strong>
            <small>
              {p.source} · {t('forecast')}: {fmtIv(p.forecastVol)}
            </small>
            <small>{t('history', { n: p.calibrationWindows, days: p.deliveryWindowDays })}</small>
          </div>
          <div>
            <span>{t('wing')}</span>
            <strong>
              {fmtIv(p.call25Iv)} / {fmtIv(p.put25Iv)}
            </strong>
            <small>
              {t('acceleration')}: {context.stress.accelerationRatio?.toFixed(2) ?? '—'}× · P
              {context.stress.accelerationPercentile?.toFixed(0) ?? '—'}
            </small>
          </div>
        </div>
        <ul className={styles.reasons}>
          {assessment.reasons.slice(3).map((reason) => (
            <li key={reason}>{t(reason)}</li>
          ))}
        </ul>
        <table className={styles.comparison}>
          <thead>
            <tr>
              <th>{t('strategy')}</th>
              <th>{t('verdict')}</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(context.assessments) as AlphaContextStrategy[]).map((key) => (
              <tr key={key} data-selected={key === strategy}>
                <td>{t(key)}</td>
                <td data-verdict={context.assessments[key].verdict}>
                  {t(context.assessments[key].verdict)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>{t('method')}</p>
        <p>{t('limit')}</p>
      </details>
    </div>
  );
}
