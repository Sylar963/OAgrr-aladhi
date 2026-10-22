import { fmtPrice, fmtStrike } from '@lib/format';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import InfoTip from '@components/ui/InfoTip';
import type { SpreadKind } from '@lib/analytics/verticalSpread';
import type { EnrichedStrike } from '@shared/enriched';
import type { ReactNode } from 'react';

import styles from './SpreadBuilderPanel.module.css';

const messages = defineMessages(
  {
    strategy: 'Strategy',
    tipLabel: 'Vertical spreads',
    tipTitle: 'Credit and debit spreads',
    debitIntro:
      'A debit spread buys the closer strike and sells the farther strike. The net debit is at risk; the short leg caps the payoff. Buying is not automatically better when selling looks unattractive.',
    creditIntroA: 'A',
    creditSpread: 'credit spread',
    creditIntroB:
      'sells a closer-to-money option and buys a farther one in the same expiry. You collect premium up front; the long leg caps your tail risk.',
    callCreditName: 'Call Credit (bear call):',
    callCreditA: 'bearish/neutral. Profit if spot stays',
    below: 'below',
    callCreditB: 'the short call strike at expiry.',
    putCreditName: 'Put Credit (bull put):',
    putCreditA: 'bullish/neutral. Profit if spot stays',
    above: 'above',
    putCreditB: 'the short put strike at expiry.',
    strikeChoice: 'How to think about strike choice:',
    strikeTip1: 'Closer-to-money short = bigger credit, lower probability.',
    strikeTip2: 'Wider gap to long = bigger max loss, better credit ratio.',
    strikeTip3: 'Look at the vol smile: sell where IV is rich relative to the wing.',
    debitAria: 'Debit spread strategy',
    callDebit: 'Call Debit',
    putDebit: 'Put Debit',
    shortLeg: 'Short leg (sell)',
    longLeg: 'Long leg (buy)',
    years: '{n} yrs',
    selectStrike: '— select strike —',
    orderCallCredit: 'Call credit: long strike must be ABOVE short strike.',
    orderCallDebit: 'Call debit: long strike must be BELOW short strike.',
    orderPutDebit: 'Put debit: long strike must be ABOVE short strike.',
    orderPutCredit: 'Put credit: long strike must be BELOW short strike.',
    hintCallDebit:
      'Bullish. Buy lower call, sell higher call. Needs an upside move beyond breakeven by expiry; upside is capped.',
    hintPutDebit:
      'Bearish. Buy higher put, sell lower put. Needs a downside move beyond breakeven by expiry; downside payoff is capped.',
    hintCallCredit:
      'Bearish/neutral. Sell lower strike call, buy higher strike call. Profit if spot stays below the short strike.',
    hintPutCredit:
      'Bullish/neutral. Sell higher strike put, buy lower strike put. Profit if spot stays above the short strike.',
  },
  {
    strategy: 'Estrategia',
    tipLabel: 'Spreads verticales',
    tipTitle: 'Spreads de crédito y débito',
    debitIntro:
      'Un spread de débito compra el strike más cercano y vende el más lejano. El débito neto está en riesgo; la pata short limita el payoff. Comprar no es automáticamente mejor cuando vender no parece atractivo.',
    creditIntroA: 'Un',
    creditSpread: 'spread de crédito',
    creditIntroB:
      'vende una opción más cerca del dinero y compra una más lejana en el mismo vencimiento. Cobras la prima por adelantado; la pata long limita tu riesgo de cola.',
    callCreditName: 'Call Credit (bear call):',
    callCreditA: 'bajista/neutral. Ganas si el spot se mantiene',
    below: 'por debajo',
    callCreditB: 'del strike del call vendido al vencimiento.',
    putCreditName: 'Put Credit (bull put):',
    putCreditA: 'alcista/neutral. Ganas si el spot se mantiene',
    above: 'por encima',
    putCreditB: 'del strike del put vendido al vencimiento.',
    strikeChoice: 'Cómo pensar la elección de strikes:',
    strikeTip1: 'Short más cerca del dinero = mayor crédito, menor probabilidad.',
    strikeTip2: 'Mayor distancia al long = mayor pérdida máx., mejor ratio de crédito.',
    strikeTip3: 'Mira el smile de vol: vende donde la IV esté cara frente al ala.',
    debitAria: 'Estrategia de spread de débito',
    callDebit: 'Call Debit',
    putDebit: 'Put Debit',
    shortLeg: 'Pata short (vender)',
    longLeg: 'Pata long (comprar)',
    years: '{n} años',
    selectStrike: '— elige strike —',
    orderCallCredit: 'Call credit: el strike long debe estar POR ENCIMA del strike short.',
    orderCallDebit: 'Call debit: el strike long debe estar POR DEBAJO del strike short.',
    orderPutDebit: 'Put debit: el strike long debe estar POR ENCIMA del strike short.',
    orderPutCredit: 'Put credit: el strike long debe estar POR DEBAJO del strike short.',
    hintCallDebit:
      'Alcista. Compra el call más bajo, vende el call más alto. Necesita una subida más allá del breakeven al vencimiento; la ganancia está limitada.',
    hintPutDebit:
      'Bajista. Compra el put más alto, vende el put más bajo. Necesita una caída más allá del breakeven al vencimiento; el payoff a la baja está limitado.',
    hintCallCredit:
      'Bajista/neutral. Vende el call de strike más bajo, compra el call de strike más alto. Ganas si el spot se mantiene por debajo del strike short.',
    hintPutCredit:
      'Alcista/neutral. Vende el put de strike más alto, compra el put de strike más bajo. Ganas si el spot se mantiene por encima del strike short.',
  },
);

type T = Translate<typeof messages.en>;

interface Props {
  kind: SpreadKind;
  onKindChange: (k: SpreadKind) => void;
  strikes: readonly EnrichedStrike[];
  atmStrike: number | null;
  shortStrike: number | null;
  longStrike: number | null;
  onShortChange: (s: number | null) => void;
  onLongChange: (s: number | null) => void;
  forward: number | null;
  T: number | null;
  children?: ReactNode;
}

function moneyness(strike: number, atm: number | null, kind: SpreadKind): 'atm' | 'itm' | 'otm' {
  if (atm == null) return 'otm';
  const near = Math.abs(strike - atm) < 1e-6;
  if (near) return 'atm';
  if (kind.startsWith('call')) {
    // Calls: ITM when strike < spot
    return strike < atm ? 'itm' : 'otm';
  }
  // Puts: ITM when strike > spot
  return strike > atm ? 'itm' : 'otm';
}

export default function SpreadBuilderPanel({
  kind,
  onKindChange,
  strikes,
  atmStrike,
  shortStrike,
  longStrike,
  onShortChange,
  onLongChange,
  forward,
  T,
  children,
}: Props) {
  const t = useT(messages);
  const orderedStrikes = [...strikes].map((s) => s.strike).sort((a, b) => a - b);

  const shortError =
    shortStrike != null && longStrike != null && !isValidLegOrder(kind, shortStrike, longStrike)
      ? legOrderHint(kind, t)
      : null;

  return (
    <div className={styles.panel}>
      <div className={styles.block}>
        <div className={styles.label}>
          {t('strategy')}
          <InfoTip label={t('tipLabel')} title={t('tipTitle')} align="start">
            <p>{t('debitIntro')}</p>
            <p>
              {t('creditIntroA')} <strong>{t('creditSpread')}</strong> {t('creditIntroB')}
            </p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
              <li>
                <strong>{t('callCreditName')}</strong> {t('callCreditA')} <em>{t('below')}</em>{' '}
                {t('callCreditB')}
              </li>
              <li>
                <strong>{t('putCreditName')}</strong> {t('putCreditA')} <em>{t('above')}</em>{' '}
                {t('putCreditB')}
              </li>
            </ul>
            <p style={{ marginTop: 6 }}>
              <strong>{t('strikeChoice')}</strong>
            </p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 14 }}>
              <li>{t('strikeTip1')}</li>
              <li>{t('strikeTip2')}</li>
              <li>{t('strikeTip3')}</li>
            </ul>
          </InfoTip>
        </div>
        <p className={styles.hint}>{kindHint(kind, t)}</p>
        <div className={styles.kindToggle} role="tablist" aria-label={t('debitAria')}>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'call-debit'}
            data-active={kind === 'call-debit'}
            onClick={() => onKindChange('call-debit')}
            className={styles.kindBtn}
          >
            {t('callDebit')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'put-debit'}
            data-active={kind === 'put-debit'}
            onClick={() => onKindChange('put-debit')}
            className={styles.kindBtn}
          >
            {t('putDebit')}
          </button>
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.label}>{t('shortLeg')}</div>
        <StrikeSelect
          value={shortStrike}
          onChange={onShortChange}
          strikes={orderedStrikes}
          atmStrike={atmStrike}
          kind={kind}
        />
      </div>

      <div className={styles.block}>
        <div className={styles.label}>{t('longLeg')}</div>
        <StrikeSelect
          value={longStrike}
          onChange={onLongChange}
          strikes={orderedStrikes}
          atmStrike={atmStrike}
          kind={kind}
        />
      </div>

      {shortError && <div className={styles.error}>{shortError}</div>}
      {children}

      {forward != null && (
        <div className={styles.paramRow}>
          <div className={styles.paramLabel}>F</div>
          <div className={styles.paramValue}>{fmtPrice(forward)}</div>
        </div>
      )}
      {T != null && (
        <div className={styles.paramRow}>
          <div className={styles.paramLabel}>T</div>
          <div className={styles.paramValue}>{t('years', { n: T.toFixed(3) })}</div>
        </div>
      )}
    </div>
  );
}

interface StrikeSelectProps {
  value: number | null;
  onChange: (s: number | null) => void;
  strikes: number[];
  atmStrike: number | null;
  kind: SpreadKind;
}

function StrikeSelect({ value, onChange, strikes, atmStrike, kind }: StrikeSelectProps) {
  const t = useT(messages);
  return (
    <select
      className={styles.select}
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? null : Number(v));
      }}
    >
      <option value="">{t('selectStrike')}</option>
      {strikes.map((s) => {
        const m = moneyness(s, atmStrike, kind);
        const label = `${fmtStrike(s)}  ${m === 'atm' ? '· ATM' : m === 'itm' ? '· ITM' : '· OTM'}`;
        return (
          <option key={s} value={s} data-moneyness={m}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

function isValidLegOrder(kind: SpreadKind, shortStrike: number, longStrike: number): boolean {
  if (kind === 'call-credit' || kind === 'put-debit') return longStrike > shortStrike;
  return longStrike < shortStrike;
}

function legOrderHint(kind: SpreadKind, t: T): string {
  if (kind === 'call-credit') return t('orderCallCredit');
  if (kind === 'call-debit') return t('orderCallDebit');
  if (kind === 'put-debit') return t('orderPutDebit');
  return t('orderPutCredit');
}

function kindHint(kind: SpreadKind, t: T): string {
  if (kind === 'call-debit') return t('hintCallDebit');
  if (kind === 'put-debit') return t('hintPutDebit');
  return kind === 'call-credit' ? t('hintCallCredit') : t('hintPutCredit');
}
