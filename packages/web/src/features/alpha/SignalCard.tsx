import InfoTip from '@components/ui/InfoTip';
import { fmtUsd } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import { memo } from 'react';
import styles from './SignalCard.module.css';
import { expiryPnl, type SpreadCandidate } from './spread-scanner';
import type { RegimeResponse } from './useRegimeQuery';

interface Props {
  candidate: SpreadCandidate | null;
  underlying: string;
  spot: number | null;
  emptyReason: string;
  regime?: RegimeResponse | null;
}

function SignalCard({ candidate, underlying, spot, emptyReason, regime }: Props) {
  const dominant = regime?.dominant ?? null;
  const direction = regime?.direction ?? null;
  const label =
    candidate?.status === 'over-budget'
      ? 'OVER BUDGET'
      : candidate?.status === 'review'
        ? 'REVIEW MODEL'
        : candidate?.status === 'no-model'
          ? 'NO MODEL'
          : 'NO MODEL EDGE';
  const tone =
    candidate?.status === 'review' ? 'SELL' : candidate?.status === 'no-model' ? 'HOLD' : 'AVOID';
  const debit = candidate?.kind.endsWith('debit') ?? false;
  const probPct = candidate?.probability == null ? null : Math.round(candidate.probability * 100);
  const cash =
    candidate == null ? null : candidate.grossPremium - candidate.entryFee - candidate.costReserve;
  return (
    <div className={styles.card} data-signal={candidate ? tone : 'HOLD'}>
      <div className={styles.header}>
        <span className={styles.label}>Model screen · your size · same venue</span>
        <InfoTip
          label="How to read the signal"
          title="Model estimate, not a trading instruction"
          align="end"
        >
          <p>
            EV averages the full expiry payoff, including partial gains and losses between strikes.
            A high probability of profit alone does not make a trade attractive.
          </p>
          <p>
            The reference model uses one flat volatility (mean of both mark IVs) and the selected
            venue’s forward. It ignores smile dynamics and jumps. Risk-neutral probability is not a
            forecast or a historical win rate.
          </p>
          <p>
            Positive model EV is a reason to inspect assumptions, not proof of an edge. Negative
            selling EV does not imply that buying the reverse spread is profitable: both sides pay
            spreads and fees.
          </p>
        </InfoTip>
      </div>
      {!candidate ? (
        <div className={styles.emptyText}>{emptyReason}</div>
      ) : (
        <>
          <div className={styles.pillRow}>
            <span className={styles.pill} data-signal={tone}>
              {label}
            </span>
            <span className={styles.reasoning}>
              {VENUES[candidate.venue]?.label ?? candidate.venue} · {candidate.quantity}{' '}
              {underlying} per leg · {candidate.direction}.{' '}
              {candidate.status === 'over-budget'
                ? 'Expiry loss exceeds your manual trade budget.'
                : candidate.status === 'review'
                  ? 'Positive under this model only. Validate price, forecast, and costs.'
                  : candidate.status === 'no-model'
                    ? 'Payoff is available; venue IV / forward is missing.'
                    : 'This quote does not show a positive edge under the reference model. Waiting is a valid choice.'}
            </span>
          </div>
          {(dominant || direction) && (
            <div className={styles.regimeRow}>
              <span className={styles.regimeLabel}>Regime context</span>
              {dominant && (
                <span className={styles.regimePill} data-regime={dominant}>
                  {dominant.toUpperCase()}
                </span>
              )}
              {direction && (
                <span className={styles.directionPill} data-direction={direction}>
                  {direction.toUpperCase()}
                </span>
              )}
              <span className={styles.regimeMeta}>Not a trade probability or an EV gate</span>
            </div>
          )}
          <div className={`${styles.stats} ${styles.guideStats}`}>
            <Stat
              label={debit ? 'Net debit + reserve' : 'Net credit − reserve'}
              value={fmtUsd(Math.abs(cash!))}
            />
            <Stat label="Max expiry profit" value={fmtUsd(candidate.maxProfit)} />
            <Stat label="Max expiry loss" value={fmtUsd(candidate.maxLoss)} loss />
            <Stat label="Account at risk" value={candidate.riskPct.toFixed(2) + '%'} loss />
            <Stat
              label="Model EV"
              value={fmtUsd(candidate.modelEdge)}
              loss={candidate.modelEdge != null && candidate.modelEdge < 0}
            />
            <Stat
              label="Model EV / max loss"
              value={
                candidate.modelEdge == null
                  ? '—'
                  : ((100 * candidate.modelEdge) / candidate.maxLoss).toFixed(1) + '%'
              }
            />
            <Stat label="Expiry breakeven" value={fmtUsd(candidate.breakeven)} />
            <Stat
              label="Max loss / max profit"
              value={(candidate.maxLoss / candidate.maxProfit).toFixed(2) + ':1'}
            />
          </div>
          <div className={styles.probBlock}>
            <div className={styles.probLabelRow}>
              <span className={styles.probLabel}>
                Risk-neutral probability of profit · not forecast
              </span>
              <span className={styles.probPct}>{probPct == null ? '—' : probPct + '%'}</span>
            </div>
            {probPct != null && (
              <div className={styles.probBar}>
                <div className={styles.probFill} style={{ width: probPct + '%' }} />
              </div>
            )}
          </div>
          <p className={styles.reasoning}>
            Entry fees {fmtUsd(candidate.entryFee)} + manual reserve {fmtUsd(candidate.costReserve)}{' '}
            included. Immediate round-trip estimate {fmtUsd(candidate.roundTrip)} (bid/ask +
            entry/exit fees; excludes reserve).
            {candidate.venue === 'thalex' && (
              <> Thalex fee assumes a combo order, not separate legs.</>
            )}{' '}
            Expiry bounds assume both legs filled and held together; they are not margin or
            liquidation limits. Confirm venue margin and settlement costs.
          </p>
          {spot != null && spot > 0 && (
            <details className={styles.guide}>
              <summary>What if {underlying} moves? · expiry scenarios</summary>
              <div className={styles.stats}>
                {[-10, -5, 0, 5, 10].map((move) => (
                  <Stat
                    key={move}
                    label={move + '% · ' + fmtUsd(spot * (1 + move / 100))}
                    value={fmtUsd(expiryPnl(candidate, spot * (1 + move / 100)))}
                    loss={expiryPnl(candidate, spot * (1 + move / 100)) < 0}
                  />
                ))}
              </div>
              <p>
                Expiry-only scenarios, not tomorrow’s mark-to-market. IV and time changes before
                expiry can move prices differently.
              </p>
            </details>
          )}
        </>
      )}
      <details className={styles.guide}>
        <summary>Why this can lose · 3-step review · book notes</summary>
        <ol>
          <li>
            Thesis: what must BTC do, by when, and why is the market price wrong? Credit collects
            premium for taking risk; debit pays for a move with capped upside.
          </li>
          <li>
            Risk: check dollar loss, fees, free margin, and your existing Portfolio exposure. Two
            bullish trades can concentrate the same risk.
          </li>
          <li>
            Plan: write the exit price, time limit, and invalidation before entering. Record the
            result after costs; do not increase size just to recover losses.
          </li>
        </ol>
        <p>
          Sinclair, Volatility Trading: “The Trading Process” p. 3; Money Management p. 101; Trade
          Evaluation pp. 128–129. Sizing cannot turn a negative edge positive; evaluate the process
          as well as P&amp;L.
        </p>
        <p>
          Bennett, Trading Volatility: “Option Trading in Practice” pp. 10–11. Strategy selection
          needs a direction, volatility view, strike, and horizon. These general principles are
          adapted to BTC—not a backtested BTC strategy.
        </p>
        <p>
          Casanovas, Opciones financieras, §5.2.1, pp. 113–120: a vertical spread combines bought
          and sold options with different strikes and the same expiry. It does not require different
          venues.
        </p>
        <p>
          Reference-model EV is a pricing comparison, not evidence you can earn it repeatedly.
          Neither selling nor buying is always preferable.
        </p>
      </details>
    </div>
  );
}

function Stat({ label, value, loss = false }: { label: string; value: string; loss?: boolean }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue} data-kind={loss ? 'loss' : undefined}>
        {value}
      </div>
    </div>
  );
}

export default memo(SignalCard);
