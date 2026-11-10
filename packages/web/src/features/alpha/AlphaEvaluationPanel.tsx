import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  AlphaEvaluationRequestSchema,
  AlphaEvaluationResponseSchema,
  type AlphaEvaluationCandidate,
  type AlphaEvaluationRequest,
  type AlphaEvaluationResponse,
} from '@oggregator/protocol';
import { fmtIv, fmtPct, fmtUsd, formatExpiry } from '@lib/format';
import { postJson } from '@lib/http';
import { useT } from '@lib/i18n';
import { evaluationMessages } from './evaluation-messages';
import { saveEvaluation } from './evaluation-journal';
import styles from './AlphaEvaluationPanel.module.css';

const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

export function evaluationIdentity(candidate: AlphaEvaluationCandidate): string {
  return JSON.stringify([
    candidate.underlying,
    candidate.strategy,
    candidate.expiryTs,
    candidate.holdingQuantity,
    candidate.legs.map((leg) => [leg.venue, leg.instrument, leg.side, leg.quantity]),
  ]);
}

export default function AlphaEvaluationPanel({
  candidate,
  quantityControl,
}: {
  candidate: AlphaEvaluationCandidate | null;
  quantityControl?: ReactNode;
}) {
  const t = useT(evaluationMessages);
  const client = useQueryClient();
  const [reserve, setReserve] = useState(
    candidate?.costReserve == null ? '' : String(candidate.costReserve),
  );
  const [budget, setBudget] = useState(
    candidate?.lossBudget == null ? '' : String(candidate.lossBudget),
  );
  const [scenarioEnabled, setScenarioEnabled] = useState(false);
  const [mean, setMean] = useState('');
  const [vol, setVol] = useState('');
  const [uncertainty, setUncertainty] = useState('0');
  const [thesis, setThesis] = useState('');
  const [invalidation, setInvalidation] = useState('');
  const [validationError, setValidationError] = useState(false);
  const identity = candidate == null ? null : evaluationIdentity(candidate);
  const formKey = JSON.stringify([
    identity,
    reserve,
    budget,
    scenarioEnabled,
    mean,
    vol,
    uncertainty,
    thesis,
    invalidation,
  ]);
  const evaluation = useMutation({
    mutationFn: async (input: { request: AlphaEvaluationRequest; formKey: string }) => ({
      response: AlphaEvaluationResponseSchema.parse(
        await postJson('/alpha/evaluate', input.request),
      ),
      formKey: input.formKey,
    }),
    retry: false,
  });
  const save = useMutation({
    mutationFn: saveEvaluation,
    onSuccess: () => client.invalidateQueries({ queryKey: ['alpha', 'evaluation-journal'] }),
    retry: false,
  });
  const result = evaluation.data?.response;
  const unchanged = evaluation.data?.formKey === formKey;
  const saved = save.isSuccess && save.variables?.id === result?.id;

  function evaluate() {
    if (candidate == null) return;
    const parsed = AlphaEvaluationRequestSchema.safeParse({
      candidate: {
        ...candidate,
        costReserve: numberOrNull(reserve),
        lossBudget: numberOrNull(budget),
      },
      scenario: scenarioEnabled
        ? {
            meanReturnPct: numberOrNull(mean),
            annualVol: vol.trim() === '' ? null : Number(vol) / 100,
            meanUncertaintyPct: numberOrNull(uncertainty),
          }
        : null,
      thesis,
      invalidation,
    });
    setValidationError(!parsed.success || parsed.data.candidate.costReserve == null);
    if (parsed.success && parsed.data.candidate.costReserve != null) {
      save.reset();
      evaluation.mutate({ request: parsed.data, formKey });
    }
  }

  return (
    <details className={styles.panel}>
      <summary>{t('title')}</summary>
      <div className={styles.body}>
        <p>{t('intro')}</p>
        {candidate != null && (
          <div className={styles.identity}>
            <span>
              {candidate.underlying} · {candidate.strategy}
            </span>
            <span>{formatExpiry(new Date(candidate.expiryTs).toISOString().slice(0, 10))}</span>
            {candidate.legs.map((leg) => (
              <span key={`${leg.venue}:${leg.side}:${leg.instrument}`}>
                {leg.side} {leg.quantity} · {leg.venue} · {leg.instrument}
              </span>
            ))}
          </div>
        )}
        {quantityControl}
        {candidate == null ? (
          <p>{t('noCandidate')}</p>
        ) : (
          <>
            <div className={styles.form}>
              <label className={styles.field}>
                {t('reserve')}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={reserve}
                  onChange={(e) => setReserve(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                {t('budget')}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
              <label className={`${styles.toggle} ${styles.wide}`}>
                <input
                  type="checkbox"
                  checked={scenarioEnabled}
                  onChange={(e) => setScenarioEnabled(e.target.checked)}
                />
                {t('scenarioToggle')}
              </label>
              {scenarioEnabled && (
                <>
                  <label className={styles.field}>
                    {t('mean')}
                    <input
                      type="number"
                      min="-99.99"
                      max="1000"
                      step="any"
                      value={mean}
                      onChange={(e) => setMean(e.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    {t('vol')}
                    <input
                      type="number"
                      min="0"
                      max="500"
                      step="any"
                      value={vol}
                      onChange={(e) => setVol(e.target.value)}
                    />
                  </label>
                  <label className={`${styles.field} ${styles.wide}`}>
                    {t('uncertainty')}
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={uncertainty}
                      onChange={(e) => setUncertainty(e.target.value)}
                    />
                  </label>
                  <p className={styles.wide}>{t('assumptions')}</p>
                </>
              )}
              <label className={styles.field}>
                {t('thesis')}
                <textarea
                  maxLength={1000}
                  value={thesis}
                  onChange={(e) => setThesis(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                {t('invalidation')}
                <textarea
                  maxLength={1000}
                  value={invalidation}
                  onChange={(e) => setInvalidation(e.target.value)}
                />
              </label>
            </div>
            <div className={styles.actions}>
              <button type="button" disabled={evaluation.isPending} onClick={evaluate}>
                {t(evaluation.isPending ? 'evaluating' : 'evaluate')}
              </button>
            </div>
          </>
        )}
        {validationError && (
          <p role="alert" className={styles.error}>
            {t('invalid')}
          </p>
        )}
        {evaluation.error && (
          <p role="alert" className={styles.error}>
            {evaluation.error.message}
          </p>
        )}
        {result && (
          <>
            <Assessment result={result} />
            {!unchanged && <p>{t('changed')}</p>}
            <div className={styles.actions}>
              <button
                type="button"
                disabled={!unchanged || save.isPending || saved || evaluation.isPending}
                onClick={() => save.mutate(result)}
              >
                {t('save')}
              </button>
              {saved && <span role="status">{t('saved')}</span>}
            </div>
            {save.error && (
              <p role="alert" className={styles.error}>
                {save.error.message}
              </p>
            )}
            <p>{t('snapshotNote')}</p>
          </>
        )}
      </div>
    </details>
  );
}

function Assessment({ result }: { result: AlphaEvaluationResponse }) {
  const t = useT(evaluationMessages);
  const { pricing, stress, execution, payoff, scenario } = result;
  const alignment = {
    aligned: 'aligned',
    conflicts: 'conflicts',
    'flat-thesis': 'flat',
    'not-specified': 'noThesis',
    insurance: 'insurance',
  } as const;
  return (
    <div className={styles.assessment}>
      <div className={styles.frozen}>
        <span>{t('frozen', { time: new Date(result.evaluatedAt).toLocaleString() })}</span>
        <span>{t('evidence')}</span>
      </div>
      <div className={styles.dimensions}>
        <section className={styles.dimension}>
          <h4>{t('direction')}</h4>
          <strong>{t(alignment[result.alignment])}</strong>
          <p>{result.request.thesis || t('noThesis')}</p>
          <dl>
            <dt>{t('netCash')}</dt>
            <dd>{fmtUsd(payoff.netEntryCash)}</dd>
            <dt>{t('maxLoss')}</dt>
            <dd>{fmtUsd(payoff.maxExpiryLoss)}</dd>
          </dl>
          {payoff.protection && (
            <dl>
              <dt>{t('coverage')}</dt>
              <dd>{fmtPct(payoff.protection.coverageRatio * 100, 1)}</dd>
              <dt>{t('zeroLoss')}</dt>
              <dd>
                {fmtUsd(payoff.protection.unhedgedLossAtZero)} /{' '}
                {fmtUsd(payoff.protection.hedgedLossAtZero)}
              </dd>
            </dl>
          )}
        </section>
        <section className={styles.dimension}>
          <h4>
            {t('pricing')} · {pricing.horizonDays.toFixed(1)}D
          </h4>
          <dl>
            <dt>{t('forecast')}</dt>
            <dd>{fmtIv(pricing.forecastVol)}</dd>
            <dt>{t('ivGap')}</dt>
            <dd>
              {pricing.ivMinusForecast == null
                ? '—'
                : `${(pricing.ivMinusForecast * 100).toFixed(1)} pts`}
            </dd>
            <dt>{t('excess')}</dt>
            <dd>
              {pricing.excessPremium == null
                ? '—'
                : `${(pricing.excessPremium * 100).toFixed(1)} pts`}
            </dd>
          </dl>
          {pricing.forecastVol == null && <p>{t('noForecast')}</p>}
          <p>
            {pricing.usualPremium == null
              ? t('noBaseline')
              : t('baseline', {
                  days: pricing.baselineTenorDays ?? '—',
                  source: pricing.baselineSource ?? '—',
                  n: pricing.baselineIndependentSamples.toFixed(1),
                })}
          </p>
          <p>{t('modelNote')}</p>
          <p>
            {t('historyThrough')}:{' '}
            {pricing.historyThrough == null
              ? '—'
              : new Date(pricing.historyThrough).toLocaleString()}
          </p>
        </section>
        <section className={styles.dimension}>
          <h4>{t('stress')}</h4>
          <dl>
            <dt>{t('rv')}</dt>
            <dd>
              {fmtIv(stress.rv7d)} / {fmtIv(stress.rv30d)}
            </dd>
            <dt>{t('acceleration')}</dt>
            <dd>
              {stress.accelerationRatio == null ? '—' : `${stress.accelerationRatio.toFixed(2)}×`}
            </dd>
            <dt>{t('returns')}</dt>
            <dd>
              {[stress.return1dPct, stress.return7dPct, stress.return30dPct]
                .map((v) => fmtPct(v, 1))
                .join(' / ')}
            </dd>
            <dt>{t('term')}</dt>
            <dd>{stress.termSlope == null ? '—' : `${(stress.termSlope * 100).toFixed(1)} pts`}</dd>
            <dt>{t('skew')}</dt>
            <dd>{stress.skew25d == null ? '—' : `${(stress.skew25d * 100).toFixed(1)} pts`}</dd>
          </dl>
          {stress.regime && (
            <strong>
              {stress.regime.volatility ?? '—'} · {stress.regime.skewSentiment ?? '—'} ·{' '}
              {fmtPct(
                stress.regime.clusterConfidence == null
                  ? null
                  : stress.regime.clusterConfidence * 100,
                0,
              )}
            </strong>
          )}
          <p>{t('regimeNote')}</p>
        </section>
        <section className={styles.dimension}>
          <h4>{t('execution')}</h4>
          <strong data-state={execution.status}>
            {t(execution.status === 'checks-pass' ? 'checksPass' : execution.status)}
          </strong>
          <ul>
            {execution.issues.map((issue) => (
              <li key={issue}>{t(issue)}</li>
            ))}
          </ul>
          <p>{t('executionNote')}</p>
          <details>
            <summary>{t('snapshotQuotes')}</summary>
            {result.request.candidate.legs.map((leg) => (
              <p key={`${leg.venue}:${leg.side}:${leg.instrument}`}>
                <strong>
                  {leg.side} {leg.quantity} · {leg.instrument} · {fmtUsd(leg.price)} /{' '}
                  {result.request.candidate.underlying}
                </strong>
                <br />
                {leg.venue} · {leg.quoteMode} ·{' '}
                {leg.quotedAt == null ? '—' : new Date(leg.quotedAt).toLocaleString()}
              </p>
            ))}
            <dl>
              <dt>{t('fees')}</dt>
              <dd>{fmtUsd(result.request.candidate.entryFee)}</dd>
              <dt>{t('reserve')}</dt>
              <dd>{fmtUsd(result.request.candidate.costReserve)}</dd>
            </dl>
          </details>
        </section>
        <section className={`${styles.dimension} ${styles.wide}`}>
          <h4>{t('scenario')}</h4>
          {scenario ? (
            <>
              <dl>
                <dt>{t('expected')}</dt>
                <dd>{fmtUsd(scenario.expectedPnl)}</dd>
                <dt>{t('odds')}</dt>
                <dd>{fmtPct(scenario.probabilityOfProfit * 100, 1)}</dd>
                <dt>{t('tail')}</dt>
                <dd>{fmtUsd(scenario.expectedShortfall95)}</dd>
                <dt>{t('sensitivity')}</dt>
                <dd>
                  {fmtUsd(scenario.lowerMeanExpectedPnl)} / {fmtUsd(scenario.upperMeanExpectedPnl)}
                </dd>
              </dl>
              <p>{t('sensitivityNote')}</p>
              <p>{t('assumptions')}</p>
            </>
          ) : (
            <p>{t(result.request.scenario == null ? 'noScenario' : 'unavailableScenario')}</p>
          )}
          {payoff.stressPoints.length > 0 && (
            <>
              <h4>{t('payoff')}</h4>
              <div className={styles.chart}>
                {payoff.stressPoints.map((point) => (
                  <div key={point.movePct} data-loss={point.pnl < 0}>
                    <span>
                      {point.movePct > 0 ? '+' : ''}
                      {point.movePct}%
                    </span>
                    {fmtUsd(point.pnl)}
                  </div>
                ))}
              </div>
              <p>{t('payoffNote')}</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
