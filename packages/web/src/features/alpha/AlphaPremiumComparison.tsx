import { fmtIv, fmtStrikeShort, fmtUsd } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import type { AlphaMarketContextResponse } from '@oggregator/protocol';
import type { EnrichedChainResponse } from '@shared/enriched';
import type { ExecutionRoute } from './SignalCard';
import type { VerticalEconomics } from './vertical-pricing';
import { comparePremiums, type PremiumTone } from './premium-comparison';
import styles from './AlphaPremiumComparison.module.css';

const messages = defineMessages(
  {
    title: 'Premium value · selected legs',
    select: 'Select a live spread and size to compare dollar premiums.',
    crossVenue: 'Dollar comparison requires both legs on the same venue.',
    inverse: 'Dollar comparison unavailable for coin settlement.',
    quotes: 'Waiting for fresh quotes and known fees.',
    reference: 'Matched-expiry volatility reference unavailable.',
    credit: 'Net credit / width',
    debit: 'Debit / width',
    near: 'NEAR REF',
    mixed: 'MIXED PRICE CHECKS',
    richCarry: 'RICH CARRY CHECKS',
    carryCheck: 'CHECK CARRY PREMIUM',
    rich: 'RICH VS REF',
    thin: 'CARRY CHECKS FAIL',
    cheap: 'CHEAP DEBIT CHECKS',
    expensive: 'DEBIT CHECKS FAIL',
    spreadValue: 'Spread $ advantage',
    buyValue: 'Long leg $ saving',
    sellValue: 'Sold leg $ richness',
    vsRef: '{price} vs {reference} ref',
    alternative: 'Long {right} · {strike}',
    call: 'call',
    put: 'put',
    saved: '{pct}% less cash',
    noSaving: 'No cash saving',
    capped: 'Cap starts {strike}',
    detail: 'Compare costs',
    wing: 'Sold wing net / ref',
    saving: 'Cash saved vs single',
    outright: 'Single option',
    spread: 'Vertical',
    maxLoss: 'Max loss',
    entry: 'Cash incl. reserve',
    referencePrice: 'Reference value',
    capTradeoff: 'Single option overtakes at expiry beyond {strike}.',
    creditAlternative: 'Same-direction single option at the short strike; different payoff.',
    method:
      'Bid/ask + entry fees + reserve, at the same size. Reference: flat {vol} volatility, current forward, zero rates. Green = price condition met; amber = near reference. Credit turns green only with rich sold-leg and net-spread prices, excess above the usual premium, and resolved stress checks. No direction forecast or proven edge.',
    usual: 'Usual premium and delivery range are in Volatility details above.',
  },
  {
    title: 'Valor de primas · patas elegidas',
    select: 'Elige un spread en vivo y tamaño para comparar primas en dólares.',
    crossVenue: 'La comparación requiere ambas patas en el mismo exchange.',
    inverse: 'Comparación en dólares no disponible para liquidación en cripto.',
    quotes: 'Esperando cotizaciones frescas y comisiones conocidas.',
    reference: 'Referencia de volatilidad al vencimiento no disponible.',
    credit: 'Crédito neto / ancho',
    debit: 'Débito / ancho',
    near: 'CERCA DE REF',
    mixed: 'PRECIO MIXTO',
    richCarry: 'PRIMA CARA CONFIRMADA',
    carryCheck: 'REVISAR PRIMA',
    rich: 'CARO VS REF',
    thin: 'PRIMA INSUFICIENTE',
    cheap: 'DÉBITO BARATO',
    expensive: 'DÉBITO NO CUMPLE',
    spreadValue: 'Ventaja $ del spread',
    buyValue: 'Ahorro $ pata long',
    sellValue: 'Riqueza $ pata vendida',
    vsRef: '{price} vs {reference} ref',
    alternative: '{right} long · {strike}',
    call: 'call',
    put: 'put',
    saved: '{pct}% menos efectivo',
    noSaving: 'Sin ahorro',
    capped: 'Tope desde {strike}',
    detail: 'Comparar costos',
    wing: 'Pata vendida neta / ref',
    saving: 'Ahorro vs opción sola',
    outright: 'Opción sola',
    spread: 'Vertical',
    maxLoss: 'Pérdida máx.',
    entry: 'Efectivo con reserva',
    referencePrice: 'Valor de referencia',
    capTradeoff: 'La opción sola supera al spread al vencimiento más allá de {strike}.',
    creditAlternative: 'Opción sola de la misma dirección al strike short; payoff diferente.',
    method:
      'Bid/ask + comisiones de entrada + reserva, al mismo tamaño. Referencia: volatilidad plana {vol}, forward actual, tasas cero. Verde = condición de precio cumplida; ámbar = cerca de referencia. El crédito solo queda verde con pata vendida y spread caros, exceso sobre prima habitual y controles de estrés resueltos. Sin pronóstico direccional ni ventaja probada.',
    usual: 'La prima habitual y el rango histórico están en Detalle de volatilidad arriba.',
  },
);

const tone = (value: number | null): PremiumTone =>
  value == null ? 'unknown' : Math.abs(value) < 0.01 ? 'watch' : value > 0 ? 'good' : 'bad';

export default function AlphaPremiumComparison({
  candidate,
  route,
  chain,
  context,
}: {
  candidate: VerticalEconomics | null;
  route: ExecutionRoute | null;
  chain: EnrichedChainResponse | undefined;
  context: AlphaMarketContextResponse | null;
}) {
  const t = useT(messages);
  const value = comparePremiums(candidate, route, chain, context);
  if (value.unavailable)
    return (
      <section className={styles.panel} aria-label={t('title')}>
        <header>{t('title')}</header>
        <p className={styles.unavailable}>{t(value.unavailable)}</p>
      </section>
    );
  const a = value.alternative;
  return (
    <section className={styles.panel} aria-label={t('title')}>
      <header>
        {t('title')}{' '}
        <span>
          {candidate?.quantity} {chain?.underlying} · {fmtIv(value.referenceVol)} ref
        </span>
      </header>
      <div className={styles.metrics}>
        <div data-tone={value.pricingTone}>
          <span>{t(value.debit ? 'debit' : 'credit')}</span>
          <strong>
            {fmtUsd(value.spreadPrice)} <small>· {value.premiumShare.toFixed(0)}%</small>
          </strong>
          <b>
            {t(
              value.pricingTone === 'watch'
                ? value.debit
                  ? 'mixed'
                  : 'carryCheck'
                : value.debit
                  ? value.pricingTone === 'good'
                    ? 'cheap'
                    : 'expensive'
                  : value.pricingTone === 'good'
                    ? 'richCarry'
                    : 'thin',
            )}
          </b>
        </div>
        <div data-tone={tone(value.debit ? value.buySaving : value.sellRichness)}>
          <span>{t(value.debit ? 'buyValue' : 'sellValue')}</span>
          <strong>{fmtUsd(value.debit ? value.buySaving : value.sellRichness)}</strong>
          <small>
            {t('vsRef', {
              price: fmtUsd(value.debit ? value.buyCost : value.sellNet),
              reference: fmtUsd(value.debit ? value.buyReference : value.sellReference),
            })}
          </small>
        </div>
        <div data-tone={tone(value.spreadAdvantage)}>
          <span>{t('spreadValue')}</span>
          <strong>{fmtUsd(value.spreadAdvantage)}</strong>
          <small>
            {t('vsRef', {
              price: fmtUsd(value.spreadPrice),
              reference: fmtUsd(value.spreadReference),
            })}
          </small>
        </div>
        <div data-tone="unknown">
          <span>
            {a
              ? t('alternative', { right: t(a.right), strike: fmtStrikeShort(a.strike) })
              : t('outright')}
          </span>
          <strong>{fmtUsd(a?.cost ?? null)}</strong>
          <small>
            {value.savingsPct != null
              ? t(value.savingsPct > 0 ? 'saved' : 'noSaving', { pct: value.savingsPct.toFixed(0) })
              : t('maxLoss')}
          </small>
        </div>
      </div>
      <details className={styles.details}>
        <summary>
          {t('detail')}
          {value.debit && candidate && (
            <span>{t('capped', { strike: fmtStrikeShort(candidate.sellStrike) })}</span>
          )}
        </summary>
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr>
                <th />
                <th>{t('spread')}</th>
                <th>{t('outright')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{t('entry')}</th>
                <td>
                  {value.debit ? '−' : '+'}
                  {fmtUsd(value.spreadPrice)}
                </td>
                <td>{a ? `−${fmtUsd(a.cost)}` : '—'}</td>
              </tr>
              <tr>
                <th>{t('maxLoss')}</th>
                <td>{fmtUsd(candidate?.maxLoss ?? null)}</td>
                <td>{fmtUsd(a?.cost ?? null)}</td>
              </tr>
              <tr>
                <th>{t('wing')}</th>
                <td>
                  {fmtUsd(value.sellNet)} / {fmtUsd(value.sellReference)}
                </td>
                <td>—</td>
              </tr>
              {value.debit && (
                <tr>
                  <th>{t('saving')}</th>
                  <td>{fmtUsd(value.savings)}</td>
                  <td>—</td>
                </tr>
              )}
              <tr>
                <th>{t('referencePrice')}</th>
                <td>{fmtUsd(value.spreadReference)}</td>
                <td>{fmtUsd(a?.reference ?? null)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {value.crossover != null && (
          <p>{t('capTradeoff', { strike: fmtStrikeShort(value.crossover) })}</p>
        )}
        {!value.debit && <p>{t('creditAlternative')}</p>}
        <p>
          {t('method', { vol: fmtIv(value.referenceVol) })} {t('usual')}
        </p>
      </details>
    </section>
  );
}
