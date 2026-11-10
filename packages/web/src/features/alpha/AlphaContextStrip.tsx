import { fmtIv } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { fmtVolPts } from '@lib/vol-richness';
import type { AlphaMarketContextResponse } from '@oggregator/protocol';
import AlphaStrategyEvidence from './AlphaStrategyEvidence';
import { premiumReference, premiumState, premiumTone } from './premium-comparison';
import styles from './AlphaContextStrip.module.css';

interface AlphaContextStripProps {
  context: AlphaMarketContextResponse | null;
  strategy:
    | 'call-credit'
    | 'put-credit'
    | 'call-debit'
    | 'put-debit'
    | 'long-call'
    | 'long-put'
    | 'protective-put'
    | 'short-straddle'
    | 'long-straddle'
    | 'iron-fly';
  loading: boolean;
}

const messages = defineMessages(
  {
    aria: 'Alpha market context',
    price: 'IV price',
    iv: 'IV / RV reference',
    premium: 'IV − RV ref',
    excess: 'Above usual premium',
    stress: 'Vol stress',
    cheap: 'CHEAP',
    rich: 'RICH',
    fair: 'FAIR',
    unavailable: 'UNAVAILABLE',
    loading: 'LOADING',
    calm: 'NORMAL',
    stressed: 'ELEVATED',
    reference: '{days}D reference',
    selected: '{days}D to expiry',
    premiumTip:
      'IV minus the matched-horizon realized-volatility estimate. High IV can still be cheap relative to this estimate. ±2 volatility points is an unvalidated display band.',
    excessTip:
      'IV minus the matched forecast minus the usual IV/realized premium. The usual premium uses the {tenor} historical baseline, a tenor proxy, not exact-expiry evidence.',
    scan: 'Scanner setup',
    favorable: 'FAVORABLE',
    watch: 'WATCH',
    expensive: 'EXPENSIVE',
    unfavorable: 'UNFAVORABLE',
  },
  {
    aria: 'Contexto de mercado Alpha',
    price: 'Precio IV',
    iv: 'IV / referencia RV',
    premium: 'IV − ref RV',
    excess: 'Sobre prima habitual',
    stress: 'Estrés vol',
    cheap: 'BARATO',
    rich: 'CARO',
    fair: 'JUSTO',
    unavailable: 'NO DISPONIBLE',
    loading: 'CARGANDO',
    calm: 'NORMAL',
    stressed: 'ELEVADO',
    reference: 'Referencia {days}D',
    selected: '{days}D al vencimiento',
    premiumTip:
      'IV menos estimación realizada al mismo horizonte. Una IV alta aún puede ser barata frente a la estimación. ±2 puntos es una banda visual no validada.',
    excessTip:
      'IV menos pronóstico menos prima IV/realizada habitual. La prima usa la base histórica {tenor}, una aproximación de plazo, no evidencia exacta del vencimiento.',
    scan: 'Setup del escáner',
    favorable: 'FAVORABLE',
    watch: 'VIGILAR',
    expensive: 'CARO',
    unfavorable: 'DESFAVORABLE',
  },
);

export default function AlphaContextStrip({ context, strategy, loading }: AlphaContextStripProps) {
  const t = useT(messages);
  const ref = premiumReference(context);
  const automatic = context?.automatic;
  const stale =
    !context || context.generatedAt > Date.now() || Date.now() - context.generatedAt > 120_000;
  const state = premiumState(stale ? null : ref.spread, ref.band);
  const excessState = premiumState(stale ? null : ref.excess, ref.band);
  const selling =
    strategy.endsWith('credit') || strategy === 'short-straddle' || strategy === 'iron-fly';
  const legacy =
    strategy === 'short-straddle' || strategy === 'long-straddle' || strategy === 'iron-fly';
  const legacySetup =
    context?.setup[strategy === 'long-straddle' ? 'longCall' : 'creditSpread'] ?? 'unavailable';
  const stressed = automatic?.stress.accelerating || automatic?.stress.backwardation;
  return (
    <section className={styles.context}>
      <div className={styles.strip} aria-label={t('aria')}>
        <div data-tone={legacy ? 'unknown' : premiumTone(state, selling)}>
          <span>{t(legacy ? 'scan' : 'price')}</span>
          <strong>{loading ? t('loading') : t(legacy ? legacySetup : state)}</strong>
          <small>
            {automatic
              ? t(automatic.horizonSource === 'selected-expiry' ? 'selected' : 'reference', {
                  days: automatic.horizonDays.toFixed(1),
                })
              : '—'}
          </small>
        </div>
        <div>
          <span>{t('iv')}</span>
          <strong>
            {fmtIv(stale ? null : ref.iv)} / {fmtIv(stale ? null : ref.forecast)}
          </strong>
        </div>
        <div data-tone={premiumTone(state, selling)} title={t('premiumTip')}>
          <span>{t('premium')}</span>
          <strong>{fmtVolPts(stale ? null : ref.spread)}</strong>
        </div>
        <div
          data-tone={premiumTone(excessState, selling)}
          title={t('excessTip', { tenor: ref.tenor.toUpperCase() })}
        >
          <span>{t('excess')}</span>
          <strong>{fmtVolPts(stale ? null : ref.excess)}</strong>
          <small>
            {ref.tenor.toUpperCase()} · {t(excessState)}
          </small>
        </div>
        <div data-tone={stale || !automatic ? 'unknown' : stressed ? 'bad' : 'watch'}>
          <span>{t('stress')}</span>
          <strong>{t(stale || !automatic ? 'unavailable' : stressed ? 'stressed' : 'calm')}</strong>
          <small>
            RV {fmtIv(context?.realized.rv7d ?? null)} / {fmtIv(context?.realized.rv30d ?? null)}
          </small>
        </div>
      </div>
      <AlphaStrategyEvidence context={context} />
    </section>
  );
}
