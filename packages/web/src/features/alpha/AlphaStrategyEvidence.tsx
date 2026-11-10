import type { AlphaMarketContextResponse } from '@oggregator/protocol';
import { fmtIv, fmtPct, fmtUsdCompact } from '@lib/format';
import { fmtPercentile, fmtVolPts, fmtZ } from '@lib/vol-richness';
import { defineMessages, useT } from '@lib/i18n';
import styles from './AlphaContextStrip.module.css';

const messages = defineMessages(
  {
    details: 'Volatility details',
    history: 'Historical delivery p20–p80',
    forecast: 'RV estimate',
    windows: '{n} non-overlapping {days}D windows',
    wings: '25Δ call / put IV proxy',
    level: '30D IV / own history',
    baseline: 'Usual premium 7D / 30D',
    move: '7D implied move',
    acceleration: 'RV acceleration',
    range: '14D range / spot',
    limits:
      'Reference estimates and historical ranges; no direction forecast. Green = pricing condition met, red = unmet, amber = mixed or near reference, gray = unavailable. Dollar prices depend on the selected legs, fees and size.',
  },
  {
    details: 'Detalle de volatilidad',
    history: 'Rango realizado histórico p20–p80',
    forecast: 'Estimación RV',
    windows: '{n} ventanas de {days}D sin solapamiento',
    wings: 'Proxy IV call / put 25Δ',
    level: 'IV 30D / historial propio',
    baseline: 'Prima habitual 7D / 30D',
    move: 'Movimiento implícito 7D',
    acceleration: 'Aceleración RV',
    range: 'Rango 14D / spot',
    limits:
      'Estimaciones y rangos históricos; sin pronóstico direccional. Verde = condición de precio cumplida, rojo = incumplida, ámbar = mixto o cerca de referencia, gris = no disponible. Los dólares dependen de patas, comisiones y tamaño.',
  },
);

export default function AlphaStrategyEvidence({
  context,
}: {
  context: AlphaMarketContextResponse | null;
}) {
  const t = useT(messages);
  const p = context?.automatic?.pricing;
  const stress = context?.automatic?.stress;
  const move = context?.expectedMoves.find((m) => m.days === 7);
  return (
    <details className={styles.evidence}>
      <summary>{t('details')}</summary>
      <div className={styles.evidenceGrid}>
        <div>
          <span>{t('history')}</span>
          <strong>
            {fmtIv(p?.deliveryLow ?? null)}–{fmtIv(p?.deliveryHigh ?? null)}
          </strong>
          <small>
            {t('windows', { n: p?.calibrationWindows ?? 0, days: p?.deliveryWindowDays ?? 0 })}
          </small>
        </div>
        <div>
          <span>{t('wings')}</span>
          <strong>
            {fmtIv(p?.call25Iv ?? null)} / {fmtIv(p?.put25Iv ?? null)}
          </strong>
          <small>{p?.source ?? '—'}</small>
        </div>
        <div>
          <span>{t('level')}</span>
          <strong>
            {fmtIv(context?.volatility.atmIv30d ?? null)} ·{' '}
            {fmtPercentile(context?.volatility.ivPercentile30d)}
          </strong>
          <small>90D</small>
        </div>
        <div>
          <span>{t('baseline')}</span>
          <strong>
            {fmtVolPts(context?.richness?.tenors['7d'].premiumBaseline.medianSpread)} /{' '}
            {fmtVolPts(context?.richness?.tenors['30d'].premiumBaseline.medianSpread)}
          </strong>
          <small>7D {fmtZ(context?.richness?.tenors['7d'].intraday.zScore24h)} 24h</small>
        </div>
        <div>
          <span>{t('move')}</span>
          <strong>
            {fmtPct(move?.movePct ?? null, 1)} · {fmtUsdCompact(move?.moveUsd ?? null)}
          </strong>
        </div>
        <div>
          <span>{t('acceleration')}</span>
          <strong>
            {stress?.accelerationRatio?.toFixed(2) ?? '—'}× ·{' '}
            {fmtPercentile(stress?.accelerationPercentile)}
          </strong>
        </div>
        <div>
          <span>{t('range')}</span>
          <strong>
            {fmtPct(context?.range.width14dPct ?? null, 1)} / {context?.spotState.state ?? '—'}
          </strong>
        </div>
      </div>
      <p>{t('limits')}</p>
    </details>
  );
}
