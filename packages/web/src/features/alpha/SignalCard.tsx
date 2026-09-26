import InfoTip from '@components/ui/InfoTip';
import { fmtUsd } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import type { VenueId } from '@shared/enriched';
import { memo } from 'react';
import styles from './SignalCard.module.css';
import type { RegimeResponse } from './useRegimeQuery';
import { expiryPnl, type VerticalEconomics } from './vertical-pricing';

export interface ExecutionRoute {
  sellVenue: VenueId;
  buyVenue: VenueId;
}

interface Props {
  candidate: VerticalEconomics | null;
  route: ExecutionRoute | null;
  underlying: string;
  spot: number | null;
  emptyReason: string;
  emptyState: 'equity' | 'market' | 'quote';
  riskBudgetPct: number;
  regime?: RegimeResponse | null;
}

const STATUS = {
  review: { label: 'CHECK SETUP', tone: 'review', message: 'Model-positive · verify assumptions' },
  'no-edge': { label: 'WAIT', tone: 'avoid', message: 'Price does not cover modeled risk' },
  'over-budget': { label: 'TOO LARGE', tone: 'danger', message: 'Loss exceeds your risk limit' },
  'no-model': { label: 'PRICE ONLY', tone: 'neutral', message: 'Payoff known · model unavailable' },
} as const;

function SignalCard({
  candidate,
  route,
  underlying,
  spot,
  emptyReason,
  emptyState,
  riskBudgetPct,
  regime,
}: Props) {
  const dominant = regime?.dominant ?? null;
  const direction = regime?.direction ?? null;

  return (
    <section className={styles.card} data-state={candidate?.status ?? 'empty'}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Spread decision</span>
          <h2 className={styles.title}>Price · payoff · account risk</h2>
        </div>
        <InfoTip label="How to read this screen" title="A filter, not an instruction" align="end">
          <p>
            Green means the quote passes the current model and your loss limit. It still needs a
            thesis and an execution check.
          </p>
          <p>
            Probability is risk-neutral and model EV uses a simplified flat-volatility distribution.
            Neither is a forecast or a historical win rate.
          </p>
        </InfoTip>
      </header>

      {!candidate || !route ? (
        <EmptyDecisionState state={emptyState} reason={emptyReason} />
      ) : (
        <CandidateDashboard
          candidate={candidate}
          route={route}
          underlying={underlying}
          spot={spot}
          riskBudgetPct={riskBudgetPct}
          dominant={dominant}
          direction={direction}
        />
      )}
    </section>
  );
}

function CandidateDashboard({
  candidate,
  route,
  underlying,
  spot,
  riskBudgetPct,
  dominant,
  direction,
}: {
  candidate: VerticalEconomics;
  route: ExecutionRoute;
  underlying: string;
  spot: number | null;
  riskBudgetPct: number;
  dominant: RegimeResponse['dominant'] | null;
  direction: RegimeResponse['direction'] | null;
}) {
  const status = STATUS[candidate.status];
  const debit = candidate.kind.endsWith('debit');
  const cross = route.buyVenue !== route.sellVenue;
  const sellLabel = VENUES[route.sellVenue]?.label ?? route.sellVenue;
  const buyLabel = VENUES[route.buyVenue]?.label ?? route.buyVenue;
  const netCash = candidate.grossPremium - candidate.entryFee - candidate.costReserve;
  const probability = candidate.probability == null ? null : candidate.probability * 100;
  const budgetUsd =
    candidate.riskPct > 0 && riskBudgetPct > 0
      ? (candidate.maxLoss * riskBudgetPct) / candidate.riskPct
      : null;
  const budgetUse = budgetUsd == null ? null : (candidate.maxLoss / budgetUsd) * 100;
  const rewardShare = (candidate.maxProfit / (candidate.maxProfit + candidate.maxLoss)) * 100;

  return (
    <>
      <div className={styles.decisionRow}>
        <div className={styles.statusLockup} data-tone={status.tone}>
          <span className={styles.statusBeacon} aria-hidden="true" />
          <div>
            <strong>{status.label}</strong>
            <span>{status.message}</span>
          </div>
        </div>
        <div className={styles.contractLine}>
          <strong>{cross ? `${sellLabel} sell → ${buyLabel} buy` : sellLabel}</strong>
          {cross && <span>non-atomic</span>}
          <span>
            {candidate.quantity} {underlying}
          </span>
          <span className={styles.direction} data-direction={candidate.direction}>
            {candidate.direction}
          </span>
          {dominant && <span>{dominant}</span>}
          {direction && <span>{direction}</span>}
        </div>
      </div>

      <div className={styles.visualGrid}>
        <div className={`${styles.visualPanel} ${styles.payoffPanel}`}>
          <div className={styles.panelHeader}>
            <span>Expiry payoff</span>
            <strong>{candidate.kind.replace('-', ' ')}</strong>
          </div>
          <PayoffChart candidate={candidate} spot={spot} />
          <div className={styles.payoffLegend}>
            <span data-kind="loss">−{fmtUsd(candidate.maxLoss)} max loss</span>
            <span data-kind="profit">+{fmtUsd(candidate.maxProfit)} max profit</span>
          </div>
        </div>

        <div className={styles.visualPanel}>
          <div className={styles.panelHeader}>
            <span>Risk budget used</span>
            <strong data-kind={budgetUse != null && budgetUse > 100 ? 'loss' : 'profit'}>
              {budgetUse == null ? '—' : `${budgetUse.toFixed(0)}%`}
            </strong>
          </div>
          <RiskMeter value={budgetUse} />
          <div className={styles.meterLabels}>
            <span>Risk {fmtUsd(candidate.maxLoss)}</span>
            <span>Limit {fmtUsd(budgetUsd)}</span>
          </div>
          <div className={styles.balanceBlock}>
            <span className={styles.miniLabel}>Loss / reward balance</span>
            <div className={styles.balanceBar}>
              <span className={styles.lossBalance} style={{ width: `${100 - rewardShare}%` }} />
              <span className={styles.profitBalance} style={{ width: `${rewardShare}%` }} />
            </div>
            <div className={styles.meterLabels}>
              <span>{(candidate.maxLoss / candidate.maxProfit).toFixed(2)}× risk</span>
              <span>1× reward</span>
            </div>
          </div>
        </div>

        <div className={`${styles.visualPanel} ${styles.probabilityPanel}`}>
          <div className={styles.panelHeader}>
            <span>Model probability</span>
            <strong>Not a forecast</strong>
          </div>
          <ProbabilityDial value={probability} />
          <div className={styles.probabilityLegend}>
            <span data-kind="profit">profit zone</span>
            <span data-kind="loss">loss zone</span>
          </div>
        </div>
      </div>

      <div className={styles.metricsStrip}>
        <Metric label={debit ? 'Cash paid' : 'Credit kept'} value={fmtUsd(Math.abs(netCash))} />
        <Metric label="Breakeven" value={fmtUsd(candidate.breakeven)} />
        <Metric
          label="Model EV"
          value={fmtUsd(candidate.modelEdge)}
          tone={candidate.modelEdge != null && candidate.modelEdge > 0 ? 'profit' : 'loss'}
        />
        <Metric label="Account at risk" value={`${candidate.riskPct.toFixed(2)}%`} tone="loss" />
        <Metric label="Entry fees" value={fmtUsd(candidate.entryFee)} />
        <Metric label="Round trip est." value={fmtUsd(candidate.roundTrip)} />
      </div>

      {spot != null && spot > 0 && <ScenarioMeter candidate={candidate} spot={spot} />}

      <details className={styles.review}>
        <summary>Before trading · 3 checks</summary>
        <div className={styles.reviewGrid}>
          <ReviewStep
            number="01"
            title="Thesis"
            text="What must BTC do by expiry? What proves you wrong?"
          />
          <ReviewStep
            number="02"
            title="Account"
            text="Check free margin and overlapping Portfolio risk."
          />
          <ReviewStep
            number="03"
            title="Exit"
            text="Set price, time limit and invalidation before entry."
          />
        </div>
        <p className={styles.footnote}>
          Fees {fmtUsd(candidate.entryFee)} + reserve {fmtUsd(candidate.costReserve)} included.
          Expiry bounds require both legs to fill and remain paired. Confirm venue margin and final
          order price.
          {cross &&
            ` Cross-venue: legs fill independently, so one can fill without the other, and ${sellLabel} margins the short leg as a naked short — collateral can far exceed max loss.`}
        </p>
      </details>
    </>
  );
}

function EmptyDecisionState({ state, reason }: { state: Props['emptyState']; reason: string }) {
  const steps = [
    { label: 'Account size', state: state === 'equity' ? 'active' : 'done' },
    {
      label: 'Live pair',
      state:
        state === 'equity'
          ? 'waiting'
          : state === 'quote' || state === 'market'
            ? 'blocked'
            : 'done',
    },
    { label: 'Risk map', state: 'waiting' },
  ] as const;
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptySignal} aria-hidden="true">
        <span>∿</span>
      </div>
      <div className={styles.emptyCopy}>
        <strong>
          {state === 'equity'
            ? 'Set your account size'
            : state === 'market'
              ? 'Market data unavailable'
              : 'Selected pair is not executable'}
        </strong>
        <p>{reason}</p>
      </div>
      <div className={styles.pipeline}>
        {steps.map((step, index) => (
          <div className={styles.pipelineStep} data-state={step.state} key={step.label}>
            <span className={styles.pipelineNode}>
              {step.state === 'done' ? '✓' : step.state === 'blocked' ? '!' : index + 1}
            </span>
            <span>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayoffChart({ candidate, spot }: { candidate: VerticalEconomics; spot: number | null }) {
  const lowStrike = Math.min(candidate.buyStrike, candidate.sellStrike);
  const highStrike = Math.max(candidate.buyStrike, candidate.sellStrike);
  const width = highStrike - lowStrike;
  const from = lowStrike - width * 0.8;
  const to = highStrike + width * 0.8;
  const chartWidth = 520;
  const chartHeight = 132;
  const padding = 10;
  const scaleX = (price: number) =>
    padding + ((price - from) / (to - from)) * (chartWidth - padding * 2);
  const scaleY = (pnl: number) =>
    padding +
    ((candidate.maxProfit - pnl) / (candidate.maxProfit + candidate.maxLoss)) *
      (chartHeight - padding * 2);
  const points = Array.from({ length: 41 }, (_, index) => {
    const price = from + ((to - from) * index) / 40;
    return `${scaleX(price)},${scaleY(expiryPnl(candidate, price))}`;
  }).join(' ');
  const zeroY = scaleY(0);
  const spotX = spot != null && spot >= from && spot <= to ? scaleX(spot) : null;

  return (
    <div className={styles.chartWrap}>
      <svg
        className={styles.payoffChart}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={`Expiry payoff from ${fmtUsd(from)} to ${fmtUsd(to)}`}
      >
        <rect x="0" y="0" width={chartWidth} height={zeroY} className={styles.profitZone} />
        <rect
          x="0"
          y={zeroY}
          width={chartWidth}
          height={chartHeight - zeroY}
          className={styles.lossZone}
        />
        <line x1="0" x2={chartWidth} y1={zeroY} y2={zeroY} className={styles.zeroLine} />
        {[candidate.buyStrike, candidate.sellStrike].map((strike) => (
          <line
            key={strike}
            x1={scaleX(strike)}
            x2={scaleX(strike)}
            y1="0"
            y2={chartHeight}
            className={styles.strikeLine}
          />
        ))}
        {spotX != null && (
          <line x1={spotX} x2={spotX} y1="0" y2={chartHeight} className={styles.spotLine} />
        )}
        <polyline points={points} className={styles.payoffPathGlow} />
        <polyline points={points} className={styles.payoffPath} />
      </svg>
      <span
        className={styles.axisLabel}
        style={{ left: `${(scaleX(lowStrike) / chartWidth) * 100}%` }}
      >
        {fmtStrike(lowStrike)}
      </span>
      <span
        className={styles.axisLabel}
        style={{ left: `${(scaleX(highStrike) / chartWidth) * 100}%` }}
      >
        {fmtStrike(highStrike)}
      </span>
      {spotX != null && (
        <span className={styles.spotLabel} style={{ left: `${(spotX / chartWidth) * 100}%` }}>
          spot
        </span>
      )}
    </div>
  );
}

function RiskMeter({ value }: { value: number | null }) {
  const fill = value == null ? 0 : Math.min(value, 100);
  return (
    <div
      className={styles.riskMeter}
      aria-label={`Risk budget used ${value?.toFixed(0) ?? 'unknown'}%`}
    >
      <div className={styles.riskScale}>
        <span>0</span>
        <span>50</span>
        <span>100%</span>
      </div>
      <div className={styles.riskTrack}>
        <span
          className={styles.riskFill}
          data-over={value != null && value > 100}
          style={{ width: `${fill}%` }}
        />
        <i className={styles.riskMarker} />
      </div>
      {value != null && value > 100 && (
        <span className={styles.overflowLabel}>+{(value - 100).toFixed(0)}% over limit</span>
      )}
    </div>
  );
}

function ProbabilityDial({ value }: { value: number | null }) {
  const normalized = value == null ? 0 : Math.max(0, Math.min(value, 100));
  const circumference = 226.2;
  return (
    <div className={styles.dialWrap}>
      <svg viewBox="0 0 96 96" className={styles.dial} aria-hidden="true">
        <circle cx="48" cy="48" r="36" className={styles.dialTrack} />
        <circle
          cx="48"
          cy="48"
          r="36"
          className={styles.dialValue}
          strokeDasharray={`${(normalized / 100) * circumference} ${circumference}`}
        />
      </svg>
      <div className={styles.dialText}>
        <strong>{value == null ? '—' : `${value.toFixed(0)}%`}</strong>
        <span>profit zone</span>
      </div>
    </div>
  );
}

function ScenarioMeter({ candidate, spot }: { candidate: VerticalEconomics; spot: number }) {
  const moves = [-10, -5, 0, 5, 10];
  return (
    <details className={styles.scenarios}>
      <summary>BTC move at expiry</summary>
      <div className={styles.scenarioGrid}>
        {moves.map((move) => {
          const pnl = expiryPnl(candidate, spot * (1 + move / 100));
          const magnitude =
            pnl >= 0 ? pnl / candidate.maxProfit : Math.abs(pnl) / candidate.maxLoss;
          return (
            <div className={styles.scenario} key={move}>
              <span>
                {move > 0 ? '+' : ''}
                {move}%
              </span>
              <div className={styles.scenarioTrack}>
                <i
                  data-kind={pnl >= 0 ? 'profit' : 'loss'}
                  style={{ height: `${Math.max(4, magnitude * 100)}%` }}
                />
              </div>
              <strong data-kind={pnl >= 0 ? 'profit' : 'loss'}>{fmtUsd(pnl)}</strong>
            </div>
          );
        })}
      </div>
      <p className={styles.footnote}>
        Expiry payoff only. Before expiry, time and IV also move the price.
      </p>
    </details>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'profit' | 'loss';
}) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong data-kind={tone}>{value}</strong>
    </div>
  );
}

function ReviewStep({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className={styles.reviewStep}>
      <span>{number}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function fmtStrike(value: number): string {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`
    : value.toFixed(0);
}

export default memo(SignalCard);
