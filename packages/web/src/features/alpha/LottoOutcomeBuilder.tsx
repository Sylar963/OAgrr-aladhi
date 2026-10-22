import type { AlphaLottoCandidate, AlphaLottoScannerResponse } from '@oggregator/protocol';

import { fmtIv, fmtPct, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';

import { buildLottoOutcomes, type LottoOutcome, type OutcomeStyle } from './lotto-outcomes';
import styles from './LottoOutcomeBuilder.module.css';

interface Props {
  data: AlphaLottoScannerResponse;
  targetPriceInput: string;
  expiry: string;
  riskBudgetInput: string;
  onTargetPriceChange: (value: string) => void;
  onExpiryChange: (value: string) => void;
  onRiskBudgetChange: (value: string) => void;
  onInspect: (candidate: AlphaLottoCandidate) => void;
}

const messages = defineMessages(
  {
    saferLabel: 'Safer',
    saferCharacter: 'Closer break-even',
    balancedLabel: 'Balanced',
    balancedCharacter: 'Middle ground',
    moonshotLabel: 'Moonshot',
    moonshotCharacter: 'Largest convex payout',
    days: '{date} · {n} days',
    potentialPayout: 'Potential payout',
    ifAtExpiry: 'if {underlying} is {price} at expiry',
    estMaxLoss: 'Est. max loss',
    maximumLoss: 'Maximum loss',
    plusFee: ' + fee',
    estNetIfRight: 'Est. net if right',
    netIfRight: 'Net if right',
    estReturn: 'Est. return',
    returnOnSpend: 'Return on spend',
    now: 'Now',
    profitStarts: 'Profit starts',
    yourFuture: 'Your future',
    contracts: '{n} contracts',
    dteDays: '{n} days',
    whyThisOption: 'Why this option?',
    youPay: 'You pay',
    each: '{value} each',
    feeExcluded: 'venue fee unavailable and excluded',
    feeAdjusted: 'fee-adjusted quoted entry',
    moveNeeded: 'Move needed',
    toBreakEven: 'to break even at expiry',
    liquidity: 'Liquidity',
    spread: '{pct} spread',
    quotedAtAsk: '{n} quoted at ask',
    optionPricing: 'Option pricing',
    iv: '{value} IV',
    advancedDetail: 'advanced pricing detail',
    inspect: 'Inspect contract in Advanced Radar',
    noListedExpiry: 'no listed expiry',
    eyebrow: 'Define the future you want exposure to',
    headlineA: 'You do not need certainty.',
    headlineB: 'You need capped downside.',
    lead:
      'Choose one future and the most you will spend to own it. Every result below can expire worthless. Loss is limited to the premium paid and any venue fees.',
    direction: 'Direction',
    goesUp: '{underlying} goes up',
    atExpiry: '{underlying} at expiry',
    targetAria: '{underlying} target price at expiry',
    targetPlaceholder: 'Target price',
    targetError: 'Enter a target above $0.',
    expiry: 'Expiry',
    expiryAria: 'Option expiry',
    expiryHint: '15–75 days · includes 1M and 2M calls',
    premiumBudget: 'Premium budget',
    premiumBudgetAria: 'Option premium budget',
    budgetError: 'Enter $1 to $10,000,000.',
    definedRisk: 'Your defined-risk trade',
    promise:
      'If {underlying} is {price} on {expiry}, find the best way to express it with a {budget} premium budget.',
    suggestedTarget: 'Using a suggested +20% target. Enter your own price to replace it.',
    completeFuture: 'Complete the future above to calculate outcomes.',
    usePositive: 'Use positive numbers for the target and premium budget.',
    noOutcome: 'No positive ranked outcome for this exact future.',
    tryHigher: 'Try a higher target, another expiry, or adjust the contract limits in Advanced Radar.',
    waysToOwn: 'Ways to own the upside',
    sameFuture: 'Same future. Different convexity.',
    calculated: 'Calculated at expiry from live asks. Venue fees are included when available.',
  },
  {
    saferLabel: 'Más segura',
    saferCharacter: 'Breakeven más cercano',
    balancedLabel: 'Equilibrada',
    balancedCharacter: 'Punto medio',
    moonshotLabel: 'Moonshot',
    moonshotCharacter: 'Mayor payout convexo',
    days: '{date} · {n} días',
    potentialPayout: 'Payout potencial',
    ifAtExpiry: 'si {underlying} está en {price} al vencimiento',
    estMaxLoss: 'Pérdida máx. est.',
    maximumLoss: 'Pérdida máxima',
    plusFee: ' + comisión',
    estNetIfRight: 'Neto est. si aciertas',
    netIfRight: 'Neto si aciertas',
    estReturn: 'Retorno est.',
    returnOnSpend: 'Retorno sobre lo gastado',
    now: 'Ahora',
    profitStarts: 'Inicio de ganancia',
    yourFuture: 'Tu futuro',
    contracts: '{n} contratos',
    dteDays: '{n} días',
    whyThisOption: '¿Por qué esta opción?',
    youPay: 'Pagas',
    each: '{value} c/u',
    feeExcluded: 'comisión del exchange no disponible y excluida',
    feeAdjusted: 'entrada cotizada ajustada por comisiones',
    moveNeeded: 'Movimiento necesario',
    toBreakEven: 'para llegar al breakeven al vencimiento',
    liquidity: 'Liquidez',
    spread: 'spread de {pct}',
    quotedAtAsk: '{n} cotizados al ask',
    optionPricing: 'Precio de la opción',
    iv: '{value} IV',
    advancedDetail: 'detalle avanzado de precio',
    inspect: 'Inspeccionar contrato en Radar avanzado',
    noListedExpiry: 'sin vencimiento listado',
    eyebrow: 'Define el futuro al que quieres exposición',
    headlineA: 'No necesitas certeza.',
    headlineB: 'Necesitas una pérdida limitada.',
    lead:
      'Elige un futuro y lo máximo que gastarás para capturarlo. Cada resultado de abajo puede vencer sin valor. La pérdida se limita a la prima pagada y las comisiones del exchange.',
    direction: 'Dirección',
    goesUp: '{underlying} sube',
    atExpiry: '{underlying} al vencimiento',
    targetAria: 'Precio objetivo de {underlying} al vencimiento',
    targetPlaceholder: 'Precio objetivo',
    targetError: 'Ingresa un objetivo mayor a $0.',
    expiry: 'Vencimiento',
    expiryAria: 'Vencimiento de la opción',
    expiryHint: '15–75 días · incluye calls de 1M y 2M',
    premiumBudget: 'Presupuesto de prima',
    premiumBudgetAria: 'Presupuesto de prima de la opción',
    budgetError: 'Ingresa de $1 a $10,000,000.',
    definedRisk: 'Tu trade de riesgo definido',
    promise:
      'Si {underlying} está en {price} el {expiry}, encuentra la mejor forma de expresarlo con un presupuesto de prima de {budget}.',
    suggestedTarget: 'Se usa un objetivo sugerido de +20%. Ingresa tu propio precio para reemplazarlo.',
    completeFuture: 'Completa el futuro de arriba para calcular resultados.',
    usePositive: 'Usa números positivos para el objetivo y el presupuesto de prima.',
    noOutcome: 'Ningún resultado positivo clasificado para este futuro exacto.',
    tryHigher: 'Prueba un objetivo más alto, otro vencimiento o ajusta los límites del contrato en Radar avanzado.',
    waysToOwn: 'Formas de capturar el alza',
    sameFuture: 'Mismo futuro. Distinta convexidad.',
    calculated: 'Calculado al vencimiento con asks en vivo. Las comisiones del exchange se incluyen cuando están disponibles.',
  },
);

type MessageKey = keyof typeof messages.en;

interface StyleMeta {
  order: string;
  label: MessageKey;
  character: MessageKey;
}

const STYLE_META: Record<OutcomeStyle, StyleMeta> = {
  safer: {
    order: '01',
    label: 'saferLabel',
    character: 'saferCharacter',
  },
  balanced: {
    order: '02',
    label: 'balancedLabel',
    character: 'balancedCharacter',
  },
  moonshot: {
    order: '03',
    label: 'moonshotLabel',
    character: 'moonshotCharacter',
  },
};

function suggestedTarget(indexPrice: number | null): number | null {
  if (indexPrice == null || indexPrice <= 0) return null;
  // One step below the price's leading digit: $81k → 1,000s, $105 → 10s, $0.08 → 0.001s.
  const step = 10 ** (Math.floor(Math.log10(indexPrice)) - 1);
  return Number((Math.ceil((indexPrice * 1.2) / step) * step).toPrecision(12));
}

function validPositiveNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validRiskBudget(value: string): number | null {
  const parsed = validPositiveNumber(value);
  return parsed != null && parsed <= 10_000_000 ? parsed : null;
}

function formatQuantity(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function expiryDte(expiry: string, data: AlphaLottoScannerResponse): number | null {
  const candidate = data.candidates.find((entry) => entry.expiry === expiry);
  if (candidate != null) return candidate.dte;
  const expiryTs = Date.parse(`${expiry}T08:00:00Z`);
  if (!Number.isFinite(expiryTs)) return null;
  return (expiryTs - data.generatedAt) / 86_400_000;
}

function expiryOptionLabel(
  expiry: string,
  data: AlphaLottoScannerResponse,
  t: Translate<typeof messages.en>,
): string {
  const dte = expiryDte(expiry, data);
  return dte == null
    ? formatExpiry(expiry)
    : t('days', { date: formatExpiry(expiry), n: Math.max(0, Math.round(dte)) });
}

function OutcomeCard({ outcome, targetPrice, onInspect }: {
  outcome: LottoOutcome;
  targetPrice: number;
  onInspect: (candidate: AlphaLottoCandidate) => void;
}) {
  const t = useT(messages);
  const { candidate } = outcome;
  const meta = STYLE_META[outcome.style];

  return (
    <article className={styles.outcomeCard} data-style={outcome.style}>
      <div className={styles.cardTopline}>
        <span className={styles.cardOrder}>{meta.order}</span>
        <div>
          <strong>{t(meta.label)}</strong>
          <span>{t(meta.character)}</span>
        </div>
        <span className={styles.venue}>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
      </div>

      <div className={styles.payoutBlock}>
        <span>{t('potentialPayout')}</span>
        <strong>{fmtUsdCompact(outcome.payout)}</strong>
        <small>{t('ifAtExpiry', { underlying: candidate.underlying, price: fmtUsdCompact(targetPrice) })}</small>
      </div>

      <div className={styles.outcomeStats}>
        <div>
          <span>{candidate.takerFee == null ? t('estMaxLoss') : t('maximumLoss')}</span>
          <strong data-tone="loss">
            {fmtUsd(outcome.spend)}{candidate.takerFee == null ? t('plusFee') : ''}
          </strong>
        </div>
        <div>
          <span>{candidate.takerFee == null ? t('estNetIfRight') : t('netIfRight')}</span>
          <strong data-tone="profit">+{fmtUsdCompact(outcome.profit)}</strong>
        </div>
        <div>
          <span>{candidate.takerFee == null ? t('estReturn') : t('returnOnSpend')}</span>
          <strong>{outcome.returnMultiple.toFixed(1)}×</strong>
        </div>
      </div>

      <div className={styles.pricePath}>
        <div>
          <span>{t('now')}</span>
          <strong>{fmtUsdCompact(candidate.indexPrice)}</strong>
        </div>
        <span className={styles.pathArrow}>→</span>
        <div>
          <span>{t('profitStarts')}</span>
          <strong>{fmtUsdCompact(candidate.breakEvenPrice)}</strong>
        </div>
        <span className={styles.pathArrow}>→</span>
        <div>
          <span>{t('yourFuture')}</span>
          <strong>{fmtUsdCompact(targetPrice)}</strong>
        </div>
      </div>

      <div className={styles.contractLine}>
        <span>{candidate.instrument}</span>
        <span>{t('contracts', { n: formatQuantity(outcome.quantity) })}</span>
        <span>{t('dteDays', { n: candidate.dte.toFixed(1) })}</span>
      </div>

      <details className={styles.explanation}>
        <summary>{t('whyThisOption')}</summary>
        <div className={styles.explanationGrid}>
          <div>
            <span>{t('youPay')}</span>
            <strong>{t('each', { value: fmtUsd(candidate.entryCost) })}</strong>
            <small>{candidate.takerFee == null ? t('feeExcluded') : t('feeAdjusted')}</small>
          </div>
          <div>
            <span>{t('moveNeeded')}</span>
            <strong>{fmtPct(candidate.breakEvenMovePct, 1)}</strong>
            <small>{t('toBreakEven')}</small>
          </div>
          <div>
            <span>{t('liquidity')}</span>
            <strong>{t('spread', { pct: fmtPct(candidate.spreadPct, 1) })}</strong>
            <small>{t('quotedAtAsk', { n: formatQuantity(candidate.askSize ?? 0) })}</small>
          </div>
          <div>
            <span>{t('optionPricing')}</span>
            <strong>{t('iv', { value: fmtIv(candidate.markIv) })}</strong>
            <small>{t('advancedDetail')}</small>
          </div>
        </div>
      </details>

      <button type="button" className={styles.inspectButton} onClick={() => onInspect(candidate)}>
        {t('inspect')}
      </button>
    </article>
  );
}

export default function LottoOutcomeBuilder({
  data,
  targetPriceInput,
  expiry,
  riskBudgetInput,
  onTargetPriceChange,
  onExpiryChange,
  onRiskBudgetChange,
  onInspect,
}: Props) {
  const t = useT(messages);
  const fallbackTarget = suggestedTarget(data.indexPrice);
  const targetInputEmpty = targetPriceInput.trim() === '';
  const targetPrice = targetInputEmpty ? fallbackTarget : validPositiveNumber(targetPriceInput);
  const riskBudget = validRiskBudget(riskBudgetInput);
  const targetInvalid = !targetInputEmpty && targetPrice == null;
  const budgetInvalid = riskBudget == null;
  const availableExpiries = [...data.eligibleExpiries].sort();
  const candidateExpiries = new Set(data.candidates.map((candidate) => candidate.expiry));
  const defaultExpiry = availableExpiries.find((candidateExpiry) => candidateExpiries.has(candidateExpiry))
    ?? availableExpiries[0]
    ?? '';
  const resolvedExpiry = availableExpiries.includes(expiry) ? expiry : defaultExpiry;
  const expiryLabel = resolvedExpiry === '' ? t('noListedExpiry') : formatExpiry(resolvedExpiry);
  const outcomes = targetPrice == null || riskBudget == null
    ? []
    : buildLottoOutcomes(data.candidates, targetPrice, riskBudget, resolvedExpiry);

  return (
    <div className={styles.builder}>
      <div className={styles.thesis}>
        <div className={styles.thesisLead}>
          <span className={styles.thesisEyebrow}>{t('eyebrow')}</span>
          <h3>{t('headlineA')}<br />{t('headlineB')}</h3>
          <p>{t('lead')}</p>
        </div>

        <div className={styles.thesisInputs}>
          <div className={styles.directionInput}>
            <span className={styles.step}>01</span>
            <div>
              <label>{t('direction')}</label>
              <strong>{t('goesUp', { underlying: data.underlying })}</strong>
            </div>
          </div>

          <label className={styles.builderInput} data-invalid={targetInvalid || undefined}>
            <span className={styles.step}>02</span>
            <div>
              <span className={styles.inputLabel}>{t('atExpiry', { underlying: data.underlying })}</span>
              <div className={styles.inputShell}>
                <span>$</span>
                <input
                  inputMode="decimal"
                  aria-label={t('targetAria', { underlying: data.underlying })}
                  aria-invalid={targetInvalid}
                  aria-errormessage={targetInvalid ? 'lotto-target-error' : undefined}
                  value={targetPriceInput}
                  placeholder={fallbackTarget == null ? t('targetPlaceholder') : String(fallbackTarget)}
                  onChange={(event) => onTargetPriceChange(event.target.value)}
                />
              </div>
              {targetInvalid && (
                <small id="lotto-target-error" className={styles.inputError} role="alert">
                  {t('targetError')}
                </small>
              )}
            </div>
          </label>

          <label className={styles.builderInput}>
            <span className={styles.step}>03</span>
            <div>
              <span className={styles.inputLabel}>{t('expiry')}</span>
              <select
                aria-label={t('expiryAria')}
                value={resolvedExpiry}
                disabled={availableExpiries.length === 0}
                onChange={(event) => onExpiryChange(event.target.value)}
              >
                {availableExpiries.map((candidateExpiry) => (
                  <option key={candidateExpiry} value={candidateExpiry}>
                    {expiryOptionLabel(candidateExpiry, data, t)}
                  </option>
                ))}
              </select>
              <small className={styles.inputHint}>{t('expiryHint')}</small>
            </div>
          </label>

          <label className={styles.builderInput} data-invalid={budgetInvalid || undefined}>
            <span className={styles.step}>04</span>
            <div>
              <span className={styles.inputLabel}>{t('premiumBudget')}</span>
              <div className={styles.inputShell}>
                <span>$</span>
                <input
                  inputMode="decimal"
                  aria-label={t('premiumBudgetAria')}
                  aria-invalid={budgetInvalid}
                  aria-errormessage={budgetInvalid ? 'lotto-budget-error' : undefined}
                  value={riskBudgetInput}
                  onChange={(event) => onRiskBudgetChange(event.target.value)}
                />
              </div>
              {budgetInvalid && (
                <small id="lotto-budget-error" className={styles.inputError} role="alert">
                  {t('budgetError')}
                </small>
              )}
            </div>
          </label>
        </div>
      </div>

      <div className={styles.promiseBar}>
        <span>{t('definedRisk')}</span>
        <strong>
          {t('promise', {
            underlying: data.underlying,
            price: fmtUsdCompact(targetPrice),
            expiry: expiryLabel,
            budget: fmtUsd(riskBudget),
          })}
        </strong>
        {targetInputEmpty && fallbackTarget != null && <small>{t('suggestedTarget')}</small>}
      </div>

      {targetInvalid || budgetInvalid ? (
        <div className={styles.noOutcomes}>
          <strong>{t('completeFuture')}</strong>
          <span>{t('usePositive')}</span>
        </div>
      ) : outcomes.length === 0 ? (
        <div className={styles.noOutcomes}>
          <strong>{t('noOutcome')}</strong>
          <span>{t('tryHigher')}</span>
        </div>
      ) : (
        <div className={styles.outcomeSection}>
          <div className={styles.sectionHeader}>
            <div>
              <span>{t('waysToOwn')}</span>
              <strong>{t('sameFuture')}</strong>
            </div>
            <small>{t('calculated')}</small>
          </div>
          <div className={styles.outcomeGrid}>
            {outcomes.map((outcome) => (
              <OutcomeCard
                key={`${outcome.candidate.venue}:${outcome.candidate.instrument}`}
                outcome={outcome}
                targetPrice={targetPrice ?? 0}
                onInspect={onInspect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
