import type { AlphaLottoCandidate, AlphaLottoScannerResponse } from '@oggregator/protocol';

import { fmtIv, fmtPct, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
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

interface StyleMeta {
  order: string;
  label: string;
  character: string;
}

const STYLE_META: Record<OutcomeStyle, StyleMeta> = {
  safer: {
    order: '01',
    label: 'Safer',
    character: 'Closer break-even',
  },
  balanced: {
    order: '02',
    label: 'Balanced',
    character: 'Middle ground',
  },
  moonshot: {
    order: '03',
    label: 'Moonshot',
    character: 'Largest convex payout',
  },
};

function suggestedTarget(indexPrice: number | null): number | null {
  if (indexPrice == null || indexPrice <= 0) return null;
  const step = indexPrice >= 10_000 ? 1_000 : indexPrice >= 1_000 ? 100 : indexPrice >= 100 ? 10 : 1;
  return Math.ceil((indexPrice * 1.2) / step) * step;
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

function OutcomeCard({ outcome, targetPrice, onInspect }: {
  outcome: LottoOutcome;
  targetPrice: number;
  onInspect: (candidate: AlphaLottoCandidate) => void;
}) {
  const { candidate } = outcome;
  const meta = STYLE_META[outcome.style];

  return (
    <article className={styles.outcomeCard} data-style={outcome.style}>
      <div className={styles.cardTopline}>
        <span className={styles.cardOrder}>{meta.order}</span>
        <div>
          <strong>{meta.label}</strong>
          <span>{meta.character}</span>
        </div>
        <span className={styles.venue}>{VENUES[candidate.venue]?.label ?? candidate.venue}</span>
      </div>

      <div className={styles.payoutBlock}>
        <span>Potential payout</span>
        <strong>{fmtUsdCompact(outcome.payout)}</strong>
        <small>if {candidate.underlying} is {fmtUsdCompact(targetPrice)} at expiry</small>
      </div>

      <div className={styles.outcomeStats}>
        <div>
          <span>{candidate.takerFee == null ? 'Est. max loss' : 'Maximum loss'}</span>
          <strong data-tone="loss">
            {fmtUsd(outcome.spend)}{candidate.takerFee == null ? ' + fee' : ''}
          </strong>
        </div>
        <div>
          <span>{candidate.takerFee == null ? 'Est. net if right' : 'Net if right'}</span>
          <strong data-tone="profit">+{fmtUsdCompact(outcome.profit)}</strong>
        </div>
        <div>
          <span>{candidate.takerFee == null ? 'Est. return' : 'Return on spend'}</span>
          <strong>{outcome.returnMultiple.toFixed(1)}×</strong>
        </div>
      </div>

      <div className={styles.pricePath}>
        <div>
          <span>Now</span>
          <strong>{fmtUsdCompact(candidate.indexPrice)}</strong>
        </div>
        <span className={styles.pathArrow}>→</span>
        <div>
          <span>Profit starts</span>
          <strong>{fmtUsdCompact(candidate.breakEvenPrice)}</strong>
        </div>
        <span className={styles.pathArrow}>→</span>
        <div>
          <span>Your future</span>
          <strong>{fmtUsdCompact(targetPrice)}</strong>
        </div>
      </div>

      <div className={styles.contractLine}>
        <span>{candidate.instrument}</span>
        <span>{formatQuantity(outcome.quantity)} contracts</span>
        <span>{candidate.dte.toFixed(1)} days</span>
      </div>

      <details className={styles.explanation}>
        <summary>Why this option?</summary>
        <div className={styles.explanationGrid}>
          <div>
            <span>You pay</span>
            <strong>{fmtUsd(candidate.entryCost)} each</strong>
            <small>
              {candidate.takerFee == null ? 'venue fee unavailable and excluded' : 'fee-adjusted quoted entry'}
            </small>
          </div>
          <div>
            <span>Move needed</span>
            <strong>{fmtPct(candidate.breakEvenMovePct, 1)}</strong>
            <small>to break even at expiry</small>
          </div>
          <div>
            <span>Liquidity</span>
            <strong>{fmtPct(candidate.spreadPct, 1)} spread</strong>
            <small>{formatQuantity(candidate.askSize ?? 0)} quoted at ask</small>
          </div>
          <div>
            <span>Option pricing</span>
            <strong>{fmtIv(candidate.markIv)} IV</strong>
            <small>advanced pricing detail</small>
          </div>
        </div>
      </details>

      <button type="button" className={styles.inspectButton} onClick={() => onInspect(candidate)}>
        Inspect contract in Advanced Radar
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
  const expiryLabel = resolvedExpiry === '' ? 'no listed expiry' : formatExpiry(resolvedExpiry);
  const outcomes = targetPrice == null || riskBudget == null
    ? []
    : buildLottoOutcomes(data.candidates, targetPrice, riskBudget, resolvedExpiry);

  return (
    <div className={styles.builder}>
      <div className={styles.thesis}>
        <div className={styles.thesisLead}>
          <span className={styles.thesisEyebrow}>Define the future you want exposure to</span>
          <h3>You do not need certainty.<br />You need capped downside.</h3>
          <p>
            Choose one future and the most you will spend to own it. Every result below can expire
            worthless. Loss is limited to the premium paid and any venue fees.
          </p>
        </div>

        <div className={styles.thesisInputs}>
          <div className={styles.directionInput}>
            <span className={styles.step}>01</span>
            <div>
              <label>Direction</label>
              <strong>{data.underlying} goes up</strong>
            </div>
          </div>

          <label className={styles.builderInput} data-invalid={targetInvalid || undefined}>
            <span className={styles.step}>02</span>
            <div>
              <span className={styles.inputLabel}>{data.underlying} at expiry</span>
              <div className={styles.inputShell}>
                <span>$</span>
                <input
                  inputMode="decimal"
                  aria-label={`${data.underlying} target price at expiry`}
                  aria-invalid={targetInvalid}
                  aria-errormessage={targetInvalid ? 'lotto-target-error' : undefined}
                  value={targetPriceInput}
                  placeholder={fallbackTarget == null ? 'Target price' : fallbackTarget.toFixed(0)}
                  onChange={(event) => onTargetPriceChange(event.target.value)}
                />
              </div>
              {targetInvalid && (
                <small id="lotto-target-error" className={styles.inputError} role="alert">
                  Enter a target above $0.
                </small>
              )}
            </div>
          </label>

          <label className={styles.builderInput}>
            <span className={styles.step}>03</span>
            <div>
              <span className={styles.inputLabel}>Expiry</span>
              <select
                aria-label="Option expiry"
                value={resolvedExpiry}
                disabled={availableExpiries.length === 0}
                onChange={(event) => onExpiryChange(event.target.value)}
              >
                {availableExpiries.map((candidateExpiry) => (
                  <option key={candidateExpiry} value={candidateExpiry}>
                    {formatExpiry(candidateExpiry)}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <label className={styles.builderInput} data-invalid={budgetInvalid || undefined}>
            <span className={styles.step}>04</span>
            <div>
              <span className={styles.inputLabel}>Premium budget</span>
              <div className={styles.inputShell}>
                <span>$</span>
                <input
                  inputMode="decimal"
                  aria-label="Option premium budget"
                  aria-invalid={budgetInvalid}
                  aria-errormessage={budgetInvalid ? 'lotto-budget-error' : undefined}
                  value={riskBudgetInput}
                  onChange={(event) => onRiskBudgetChange(event.target.value)}
                />
              </div>
              {budgetInvalid && (
                <small id="lotto-budget-error" className={styles.inputError} role="alert">
                  Enter $1 to $10,000,000.
                </small>
              )}
            </div>
          </label>
        </div>
      </div>

      <div className={styles.promiseBar}>
        <span>Your defined-risk trade</span>
        <strong>
          If {data.underlying} is {fmtUsdCompact(targetPrice)} on {expiryLabel},
          find the best way to express it with a {fmtUsd(riskBudget)} premium budget.
        </strong>
        {targetInputEmpty && fallbackTarget != null && (
          <small>Using a suggested +20% target. Enter your own price to replace it.</small>
        )}
      </div>

      {targetInvalid || budgetInvalid ? (
        <div className={styles.noOutcomes}>
          <strong>Complete the future above to calculate outcomes.</strong>
          <span>Use positive numbers for the target and premium budget.</span>
        </div>
      ) : outcomes.length === 0 ? (
        <div className={styles.noOutcomes}>
          <strong>No positive ranked outcome for this exact future.</strong>
          <span>Try a higher target, another expiry, or adjust the contract limits in Advanced Radar.</span>
        </div>
      ) : (
        <div className={styles.outcomeSection}>
          <div className={styles.sectionHeader}>
            <div>
              <span>Ways to own the upside</span>
              <strong>Same future. Different convexity.</strong>
            </div>
            <small>Calculated at expiry from live asks. Venue fees are included when available.</small>
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
