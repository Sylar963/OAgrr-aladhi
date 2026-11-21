import { defineMessages, useLocale, useT } from '@lib/i18n';
import type { IvHistoryPoint, IvTenor } from '@shared/enriched';
import styles from './SkewReadout.module.css';
import { formatPercentile } from './skew-history-utils';

const messages = defineMessages(
  {
    scope: '{tenor} options · {days}-day history',
    comparison: '25Δ IV vs ATM',
    atm: 'ATM IV {iv}%',
    put: 'Put wing',
    call: 'Call wing',
    average: 'Average',
    lower: 'Lower IV',
    higher: 'Higher IV',
    baseline: 'ATM = 0',
    derivation: 'Wing gaps implied by ATM, RR & Fly · vol points',
    low: 'Low wing premium vs history',
    typical: 'Typical wing premium vs history',
    high: 'High wing premium vs history',
    unknown: 'Wing history unavailable',
    gauge: 'Wing premium percentile: {tenor} options, {days}-day history',
    lowLabel: 'Low',
    typicalLabel: 'Typical',
    highLabel: 'High',
    averageAbove: 'Average wings {v}vp above ATM',
    averageBelow: 'Average wings {v}vp below ATM',
    averageEqual: 'Average wings at ATM IV',
  },
  {
    scope: 'Opciones {tenor} · historial de {days} días',
    comparison: 'IV 25Δ frente a ATM',
    atm: 'IV ATM {iv}%',
    put: 'Ala put',
    call: 'Ala call',
    average: 'Promedio',
    lower: 'Menor IV',
    higher: 'Mayor IV',
    baseline: 'ATM = 0',
    derivation: 'Diferencias implícitas en ATM, RR y Fly · puntos de vol',
    low: 'Prima de alas baja frente al historial',
    typical: 'Prima de alas típica frente al historial',
    high: 'Prima de alas alta frente al historial',
    unknown: 'Sin historial de alas',
    gauge: 'Percentil de prima de alas: opciones {tenor}, historial de {days} días',
    lowLabel: 'Baja',
    typicalLabel: 'Típica',
    highLabel: 'Alta',
    averageAbove: 'IV media de alas {v}vp sobre ATM',
    averageBelow: 'IV media de alas {v}vp bajo ATM',
    averageEqual: 'IV media de alas igual a ATM',
  },
);

interface Props {
  point: IvHistoryPoint;
  percentile: number | null;
  tenor: IvTenor;
  historyDays: number;
}

export default function SkewReadout({ point, percentile, tenor, historyDays }: Props) {
  const t = useT(messages);
  const locale = useLocale();
  const { atmIv, rr25d, bfly25d } = point;
  if (
    atmIv == null ||
    !Number.isFinite(atmIv) ||
    atmIv <= 0 ||
    bfly25d == null ||
    !Number.isFinite(bfly25d)
  )
    return null;

  const fly = bfly25d * 100;
  const rr = rr25d != null && Number.isFinite(rr25d) ? rr25d * 100 : null;
  const rows = [
    ...(rr == null
      ? []
      : [
          { key: 'put', label: t('put'), value: fly - rr / 2 },
          { key: 'call', label: t('call'), value: fly + rr / 2 },
        ]),
    { key: 'average', label: t('average'), value: fly },
  ];
  const span = Math.max(...rows.map((row) => Math.abs(row.value)), 0.1);
  const pct =
    percentile != null && Number.isFinite(percentile) && percentile >= 0 && percentile <= 100
      ? percentile
      : null;
  const level = pct == null ? 'unknown' : pct <= 15 ? 'low' : pct >= 85 ? 'high' : 'typical';
  const averageText = t(fly > 0 ? 'averageAbove' : fly < 0 ? 'averageBelow' : 'averageEqual', {
    v: Math.abs(fly).toFixed(1),
  });

  return (
    <section className={styles.wrap} aria-label={t('scope', { tenor, days: historyDays })}>
      <div className={styles.scope}>{t('scope', { tenor, days: historyDays })}</div>
      <div className={styles.panels}>
        <div className={styles.comparison}>
          <div className={styles.heading}>
            <strong>{t('comparison')}</strong>
            <span>{t('atm', { iv: (atmIv * 100).toFixed(1) })}</span>
          </div>
          <div className={styles.scale} aria-hidden="true">
            <span />
            <div>
              <span>← {t('lower')}</span>
              <span>{t('baseline')}</span>
              <span>{t('higher')} →</span>
            </div>
            <span />
          </div>
          {rows.map((row) => (
            <div className={styles.row} key={row.key} data-wing={row.key}>
              <span>{row.label}</span>
              <div className={styles.track} aria-hidden="true">
                <span
                  className={styles.bar}
                  style={{
                    left: `${50 + Math.min(0, row.value / span) * 48}%`,
                    width: `${(Math.abs(row.value) / span) * 48}%`,
                  }}
                />
              </div>
              <strong>
                {row.value > 0 ? '+' : ''}
                {row.value.toFixed(1)}vp
              </strong>
            </div>
          ))}
          <div className={styles.note}>{t('derivation')}</div>
        </div>
        <div className={styles.history}>
          <strong className={styles.verdict} data-level={level}>
            {t(level)}
          </strong>
          <span className={styles.average}>{averageText}</span>
          {pct != null ? (
            <>
              <div className={styles.percentile}>{formatPercentile(pct, locale)}</div>
              <div
                className={styles.gauge}
                role="meter"
                aria-label={t('gauge', { tenor, days: historyDays })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-valuetext={`${t(level)} · ${formatPercentile(pct, locale)}`}
              >
                <span className={styles.marker} style={{ left: `${pct}%` }} />
              </div>
              <div className={styles.gaugeLabels} aria-hidden="true">
                <span>{t('lowLabel')}</span>
                <span>{t('typicalLabel')}</span>
                <span>{t('highLabel')}</span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
