import InfoTip from '@components/ui/InfoTip';
import type {
  AlphaStraddleCandidate,
  AlphaStraddleFlag,
  AlphaStraddleVerdict,
  ShortStraddleEvaluationResponse,
} from '@oggregator/protocol';
import { fmtIv, fmtPct, fmtUsd, fmtUsdCompact, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';

import signal from './SignalCard.module.css';
import styles from './StraddleScannerPanel.module.css';

export const STRADDLE_STATUS: Record<
  AlphaStraddleVerdict,
  { label: string; tone: 'review' | 'neutral' | 'danger'; message: string }
> = {
  'sell-candidate': {
    label: 'CHECK SETUP',
    tone: 'review',
    message: 'Premium clears every gate · verify thesis',
  },
  watch: { label: 'WATCH', tone: 'neutral', message: 'Rich on price · regime or data caveat' },
  cheap: { label: "CHEAP · DON'T SELL", tone: 'danger', message: 'Premium does not pay for the vol' },
  'no-forecast': { label: 'NO FORECAST', tone: 'neutral', message: 'Cannot judge premium' },
};

export const FLAG_TEXT: Record<AlphaStraddleFlag, string> = {
  iv_below_hurdle:
    'Sellable IV (bids, after fees) is not above the higher of the forecast and matched-horizon realized vol. Edge is implied minus future realized (Sinclair p. 87).',
  negative_model_edge:
    'Net credit is below the straddle’s value at the forecast vol, so the model expects to pay out more than it collects.',
  below_cone_median:
    'Sellable IV is below the median realized vol for this horizon. That is cheap versus the vol cone (Sinclair pp. 39–41).',
  below_cone_p75:
    'Sellable IV is below the 75th percentile of the vol cone. It is not historically rich for this horizon.',
  cone_unavailable: 'Not enough spot history to build the vol cone for this horizon.',
  premium_not_above_normal:
    'IV minus forecast is not above the usual implied-minus-subsequent-realized spread. That is ordinary insurance premium, which Sinclair (pp. 41–43) says is not a good enough reason to sell.',
  premium_baseline_unknown:
    'Too little IV history to measure the usual premium for this tenor. It is treated as unknown, not zero.',
  term_backwardation:
    'Front IV is above 30D IV. Turbulent regime: rich vol can be rich for a reason (Sinclair pp. 15–16; Bennett pp. 138–139).',
  spot_breaking_out: 'Spot is outside its 20-day range. Realized vol may be about to re-rate.',
  realized_accelerating:
    '7D realized vol is more than 1.25× the 30D level. The recent move may not be over.',
  gamma_window: 'Under two days to expiry. Gamma dominates and small moves swing P&L sharply.',
  size_below_minimum:
    'The risk budget or top-of-book size cannot cover the venue minimum at this stress level.',
  forecast_unavailable: 'No realized-vol forecast is available, so premium cannot be judged.',
};

type GateState = 'pass' | 'fail' | 'warn';

function gates(candidate: AlphaStraddleCandidate) {
  const has = (flag: AlphaStraddleFlag) => candidate.flags.includes(flag);
  const regimeFlags: AlphaStraddleFlag[] = [
    'term_backwardation',
    'spot_breaking_out',
    'realized_accelerating',
    'gamma_window',
  ];
  const rows: Array<{ label: string; detail: string; state: GateState }> = [
    {
      label: 'IV above forecast',
      detail: `${fmtIv(candidate.sellIv)} vs ${fmtIv(candidate.hurdleVol)}`,
      state:
        has('forecast_unavailable') || has('iv_below_hurdle') || has('negative_model_edge')
          ? 'fail'
          : 'pass',
    },
    {
      label: 'Vol cone ≥ p75',
      detail:
        candidate.conePercentile == null ? 'no cone' : `p${candidate.conePercentile.toFixed(0)}`,
      state: has('below_cone_median') ? 'fail' : has('below_cone_p75') || has('cone_unavailable') ? 'warn' : 'pass',
    },
    {
      label: 'Above usual premium',
      detail:
        candidate.excessEdge == null
          ? 'unknown'
          : `${(candidate.excessEdge * 100).toFixed(1)}pt · ${
              candidate.premiumBaseline.source === 'venue' ? 'venue history' : 'all venues'
            }`,
      state: has('premium_not_above_normal') ? 'fail' : has('premium_baseline_unknown') ? 'warn' : 'pass',
    },
    {
      label: 'Calm regime',
      detail: regimeFlags.filter(has).length === 0 ? 'no flags' : `${regimeFlags.filter(has).length} flag(s)`,
      state: regimeFlags.some(has) ? 'warn' : 'pass',
    },
  ];
  return rows;
}

interface StraddleDecisionCardProps {
  candidate: AlphaStraddleCandidate | null;
  emptyState: 'equity' | 'market' | 'quote';
  emptyReason: string;
  stressSigma: number;
  budgetUsd: number;
  evidence: ShortStraddleEvaluationResponse | null;
  evidenceUnavailable: boolean;
  onOpenBuilder: (candidate: AlphaStraddleCandidate) => void;
}

export default function StraddleDecisionCard({
  candidate,
  emptyState,
  emptyReason,
  stressSigma,
  budgetUsd,
  evidence,
  evidenceUnavailable,
  onOpenBuilder,
}: StraddleDecisionCardProps) {
  return (
    <section
      className={signal.card}
      data-state={
        candidate == null
          ? 'empty'
          : candidate.verdict === 'sell-candidate'
            ? 'review'
            : candidate.verdict === 'cheap'
              ? 'no-edge'
              : 'no-model'
      }
    >
      <header className={signal.header}>
        <div>
          <span className={signal.eyebrow}>Straddle decision</span>
          <h2 className={signal.title}>Premium · forecast · stress risk</h2>
        </div>
        <InfoTip label="How to read this screen" title="A filter, not an instruction" align="end">
          <p>
            Green means the premium clears the forecast, vol-cone and usual-premium gates and the
            stress loss fits your budget. It still needs a thesis and an execution check.
          </p>
          <p>
            The payoff is at expiry. Stress loss is a scenario, not a maximum: a short straddle's
            loss is unbounded.
          </p>
        </InfoTip>
      </header>
      {candidate == null ? (
        <EmptyState state={emptyState} reason={emptyReason} />
      ) : (
        <Dashboard
          candidate={candidate}
          stressSigma={stressSigma}
          budgetUsd={budgetUsd}
          evidence={evidence}
          evidenceUnavailable={evidenceUnavailable}
          onOpenBuilder={onOpenBuilder}
        />
      )}
    </section>
  );
}

function Dashboard({
  candidate,
  stressSigma,
  budgetUsd,
  evidence,
  evidenceUnavailable,
  onOpenBuilder,
}: Omit<StraddleDecisionCardProps, 'candidate' | 'emptyState' | 'emptyReason'> & {
  candidate: AlphaStraddleCandidate;
}) {
  const status = STRADDLE_STATUS[candidate.verdict];
  const sized = candidate.suggestedQuantity > 0;
  const quantity = sized ? candidate.suggestedQuantity : candidate.minQuantity;
  const stressUsd = quantity * candidate.stressLossUsd;
  const budgetUse = budgetUsd > 0 ? (stressUsd / budgetUsd) * 100 : null;
  const segments = evidence?.segments.filter((segment) => segment.venue === candidate.venue) ?? [];

  return (
    <>
      <div className={signal.decisionRow}>
        <div className={signal.statusLockup} data-tone={status.tone}>
          <span className={signal.statusBeacon} aria-hidden="true" />
          <div>
            <strong>{status.label}</strong>
            <span>{status.message}</span>
          </div>
        </div>
        <div className={signal.contractLine}>
          <strong>{VENUES[candidate.venue]?.label ?? candidate.venue}</strong>
          <span>
            sell {candidate.strike.toLocaleString()} C + P · {formatExpiry(candidate.expiry)} ·{' '}
            {candidate.dte.toFixed(1)}D
          </span>
          <span>
            {quantity} {candidate.underlying}
            {sized ? '' : ' (venue min)'}
          </span>
          <span className={signal.direction}>short vol</span>
        </div>
      </div>

      <div className={signal.visualGrid}>
        <div className={`${signal.visualPanel} ${signal.payoffPanel}`}>
          <div className={signal.panelHeader}>
            <span>Expiry payoff</span>
            <strong>short straddle</strong>
          </div>
          <StraddlePayoff candidate={candidate} quantity={quantity} />
          <div className={signal.payoffLegend}>
            <span data-kind="loss">
              −{fmtUsd(stressUsd)} at {stressSigma}σ
            </span>
            <span data-kind="profit">+{fmtUsd(quantity * candidate.netCredit)} max profit</span>
          </div>
        </div>

        <div className={signal.visualPanel}>
          <div className={signal.panelHeader}>
            <span>Stress budget used</span>
            <strong data-kind={budgetUse != null && budgetUse > 100 ? 'loss' : 'profit'}>
              {budgetUse == null ? '—' : `${budgetUse.toFixed(0)}%`}
            </strong>
          </div>
          <div className={signal.riskMeter}>
            <div className={signal.riskScale}>
              <span>0</span>
              <span>50</span>
              <span>100%</span>
            </div>
            <div className={signal.riskTrack}>
              <span
                className={signal.riskFill}
                data-over={budgetUse != null && budgetUse > 100}
                style={{ width: `${Math.min(budgetUse ?? 0, 100)}%` }}
              />
              <i className={signal.riskMarker} />
            </div>
            {budgetUse != null && budgetUse > 100 && (
              <span className={signal.overflowLabel}>
                +{(budgetUse - 100).toFixed(0)}% over limit
              </span>
            )}
          </div>
          <div className={signal.meterLabels}>
            <span>Stress {fmtUsd(stressUsd)}</span>
            <span>Limit {fmtUsd(budgetUsd)}</span>
          </div>
          <div className={signal.balanceBlock}>
            <span className={signal.miniLabel}>Credit / stress loss</span>
            <div className={signal.balanceBar}>
              <span
                className={signal.lossBalance}
                style={{ width: `${lossShare(candidate)}%` }}
              />
              <span
                className={signal.profitBalance}
                style={{ width: `${100 - lossShare(candidate)}%` }}
              />
            </div>
            <div className={signal.meterLabels}>
              <span>±{fmtPct(candidate.stressMovePct, 1)} move</span>
              <span>book {candidate.topOfBookQuantity}</span>
            </div>
          </div>
        </div>

        <div className={signal.visualPanel}>
          <div className={signal.panelHeader}>
            <span>Premium gates</span>
            <strong>{gates(candidate).filter((gate) => gate.state === 'pass').length}/4 pass</strong>
          </div>
          <ul className={styles.gateList}>
            {gates(candidate).map((gate) => (
              <li key={gate.label} data-state={gate.state}>
                <span aria-hidden="true">
                  {gate.state === 'pass' ? '✓' : gate.state === 'fail' ? '✕' : '!'}
                </span>
                <strong>{gate.label}</strong>
                <small>{gate.detail}</small>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={signal.metricsStrip}>
        <Metric label="Credit kept" value={fmtUsd(candidate.netCredit * quantity)} />
        <Metric
          label="Breakevens"
          value={`${fmtUsdCompact(candidate.breakevenLow)}–${fmtUsdCompact(candidate.breakevenHigh)}`}
        />
        <Metric label="Sell IV" value={`${fmtIv(candidate.sellIv)} / ${fmtIv(candidate.hurdleVol)}`} />
        <Metric
          label="Model edge"
          value={fmtUsd(candidate.modelEdgeUsd == null ? null : candidate.modelEdgeUsd * quantity)}
          tone={candidate.modelEdgeUsd != null && candidate.modelEdgeUsd > 0 ? 'profit' : 'loss'}
        />
        <Metric
          label="Inside BE (model)"
          value={
            candidate.probInsideAtForecast == null
              ? '—'
              : fmtPct(candidate.probInsideAtForecast * 100, 0)
          }
        />
        <Metric label="Entry fees" value={fmtUsd(candidate.entryFees * quantity)} />
      </div>

      <details className={signal.review}>
        <summary>
          Why this verdict ·{' '}
          {candidate.flags.length === 0 ? 'all gates pass' : `${candidate.flags.length} flags`}
        </summary>
        {candidate.flags.length === 0 ? (
          <p className={styles.passNote}>
            It clears all three gates: IV above the matched forecast, at least p75 on the vol cone,
            and above the usual premium. That supports a sell, but it is not proof of an edge.
            Record the thesis before trading.
          </p>
        ) : (
          <ul className={styles.flagList}>
            {candidate.flags.map((flag) => (
              <li key={flag}>{FLAG_TEXT[flag]}</li>
            ))}
          </ul>
        )}
        <div className={styles.evidence}>
          <span>WALK-FORWARD EVIDENCE · ATM ~7D · BIDS IN, ASKS OUT, FEES</span>
          {evidenceUnavailable ? (
            <small>Evidence collection is unavailable on this server.</small>
          ) : evidence == null ? (
            <small>Loading…</small>
          ) : segments.length === 0 ? (
            <small>
              {evidence.status === 'collecting' ? 'Collecting' : 'No completed'} samples for this
              venue yet. Nothing here validates an edge.
            </small>
          ) : (
            <div className={styles.evidenceGrid}>
              {segments.map((segment) => (
                <div key={segment.horizonHours} data-assessment={segment.assessment}>
                  <span>{segment.horizonHours}H</span>
                  <strong>{fmtUsd(segment.meanPnlUsdPerUnit)}</strong>
                  <small>
                    n={segment.independentSampleCount} · {segment.assessment.replaceAll('_', ' ')}
                  </small>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className={signal.footnote}>
          Daily breakeven move {fmtPct(candidate.dailyBreakevenMovePct, 2)} vs forecast{' '}
          {fmtPct(candidate.forecastDailyMovePct, 2)}. Premium concentrates near the strike, an
          argument for strangles (Sinclair p. 97). Being right on vol can still lose on the path
          (pp. 92–93), so size below full Kelly (p. 109).
        </p>
      </details>

      <button
        type="button"
        className={styles.builderButton}
        onClick={() => onOpenBuilder(candidate)}
      >
        <span>Open both legs in Builder V2</span>
        <span aria-hidden="true">↗</span>
      </button>
    </>
  );
}

function lossShare(candidate: AlphaStraddleCandidate): number {
  const total = candidate.stressLossUsd + candidate.netCredit;
  return total > 0 ? (candidate.stressLossUsd / total) * 100 : 50;
}

function StraddlePayoff({
  candidate,
  quantity,
}: {
  candidate: AlphaStraddleCandidate;
  quantity: number;
}) {
  const K = candidate.strike;
  const reach = Math.max(candidate.stressMovePct / 100, candidate.breakevenMovePct / 50) * 1.1;
  const from = K * (1 - reach);
  const to = K * (1 + reach);
  const pnl = (price: number) => quantity * (candidate.netCredit - Math.abs(price - K));
  const top = pnl(K);
  const bottom = Math.min(pnl(from), pnl(to));
  const chartWidth = 520;
  const chartHeight = 132;
  const padding = 10;
  const scaleX = (price: number) =>
    padding + ((price - from) / (to - from)) * (chartWidth - padding * 2);
  const scaleY = (value: number) =>
    padding + ((top - value) / (top - bottom)) * (chartHeight - padding * 2);
  const points = [from, K, to].map((price) => `${scaleX(price)},${scaleY(pnl(price))}`).join(' ');
  const zeroY = scaleY(0);
  const forwardX = scaleX(candidate.forwardPrice);
  const labels = [
    { price: candidate.breakevenLow, text: fmtUsdCompact(candidate.breakevenLow) },
    { price: K, text: fmtUsdCompact(K) },
    { price: candidate.breakevenHigh, text: fmtUsdCompact(candidate.breakevenHigh) },
  ];

  return (
    <div className={signal.chartWrap}>
      <svg
        className={signal.payoffChart}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={`Short straddle expiry payoff from ${fmtUsd(from)} to ${fmtUsd(to)}`}
      >
        <rect x="0" y="0" width={chartWidth} height={zeroY} className={signal.profitZone} />
        <rect
          x="0"
          y={zeroY}
          width={chartWidth}
          height={chartHeight - zeroY}
          className={signal.lossZone}
        />
        <line x1="0" x2={chartWidth} y1={zeroY} y2={zeroY} className={signal.zeroLine} />
        {labels.map(({ price }) => (
          <line
            key={price}
            x1={scaleX(price)}
            x2={scaleX(price)}
            y1="0"
            y2={chartHeight}
            className={signal.strikeLine}
          />
        ))}
        <line x1={forwardX} x2={forwardX} y1="0" y2={chartHeight} className={signal.spotLine} />
        <polyline points={points} className={signal.payoffPathGlow} />
        <polyline points={points} className={signal.payoffPath} />
      </svg>
      {labels.map(({ price, text }) => (
        <span
          key={price}
          className={signal.axisLabel}
          style={{ left: `${(scaleX(price) / chartWidth) * 100}%` }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'profit' | 'loss' }) {
  return (
    <div className={signal.metric}>
      <span>{label}</span>
      <strong data-kind={tone}>{value}</strong>
    </div>
  );
}

function EmptyState({
  state,
  reason,
}: {
  state: StraddleDecisionCardProps['emptyState'];
  reason: string;
}) {
  const steps = [
    { label: 'Account size', state: state === 'equity' ? 'active' : 'done' },
    { label: 'Live straddle', state: state === 'equity' ? 'waiting' : 'blocked' },
    { label: 'Risk map', state: 'waiting' },
  ] as const;
  return (
    <div className={signal.emptyState}>
      <div className={signal.emptySignal} aria-hidden="true">
        <span>∿</span>
      </div>
      <div className={signal.emptyCopy}>
        <strong>
          {state === 'equity'
            ? 'Set your account size'
            : state === 'market'
              ? 'Market data unavailable'
              : 'No executable straddle'}
        </strong>
        <p>{reason}</p>
      </div>
      <div className={signal.pipeline}>
        {steps.map((step, index) => (
          <div className={signal.pipelineStep} data-state={step.state} key={step.label}>
            <span className={signal.pipelineNode}>
              {step.state === 'done' ? '✓' : step.state === 'blocked' ? '!' : index + 1}
            </span>
            <span>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
