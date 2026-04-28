import { memo } from 'react';

import InfoTip from '@components/ui/InfoTip';
import { fmtUsd } from '@lib/format';
import type { SpreadSignal } from '@lib/analytics/verticalSpread';

import styles from './SignalCard.module.css';

interface Props {
  signal: SpreadSignal | null;
  label?: string;
}

function SignalCard({ signal, label = 'Executable (best routing)' }: Props) {
  if (!signal) {
    return (
      <div className={styles.card} data-empty="true">
        <div className={styles.emptyText}>Select short and long strikes to analyze.</div>
      </div>
    );
  }

  const probPct = Math.round(signal.successProbability * 100);

  return (
    <div className={styles.card} data-signal={signal.signal}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <InfoTip label="How to read the signal" title="Reading the signal" align="end">
          <p>
            <strong>Traffic light</strong> on this card is a gating decision, not a
            recommendation. It only fires <strong>SELL</strong> when all three
            execution conditions hold simultaneously:
          </p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
            <li><strong>Net credit &gt; 0</strong> — you actually get paid to put it on.</li>
            <li><strong>R/R ≤ 3:1</strong> — max loss is at most 3× max profit.</li>
            <li><strong>Success ≥ 65%</strong> — risk-neutral P(profit at expiry).</li>
          </ul>
          <p style={{ marginTop: 6 }}>
            <strong>AVOID</strong> = credit but R/R or probability fails the gate.
            Usually means strikes are too wide or the spread is mispriced relative
            to the smile. <strong>HOLD</strong> = the structure debits net — flip
            the legs or the strategy kind.
          </p>
          <p style={{ marginTop: 6 }}>
            <strong>How to think about it:</strong> the gate is intentionally
            conservative for credit spreads, where you collect a small premium
            against a larger possible loss. Treat <em>SELL</em> as &quot;the math
            doesn&apos;t reject this&quot; — not as edge. Always cross-check with
            the vol smile (rich short-leg IV is the actual edge).
          </p>
        </InfoTip>
      </div>

      <div className={styles.pillRow}>
        <span className={styles.pill} data-signal={signal.signal}>
          {signal.signal}
        </span>
        <span className={styles.reasoning}>{signal.reasoning}</span>
      </div>

      <div className={styles.stats}>
        <div
          className={styles.stat}
          title="Premium received minus premium paid, after taker fees on best venue per leg. Your max profit if held to expiry and short stays OTM."
        >
          <div className={styles.statLabel}>Net credit</div>
          <div className={styles.statValue} data-kind="credit">{fmtUsd(signal.netCredit)}</div>
        </div>
        <div
          className={styles.stat}
          title="Worst-case loss = strike width − net credit. Realized if spot finishes beyond the LONG strike (fully in-the-money) at expiry."
        >
          <div className={styles.statLabel}>Max loss</div>
          <div className={styles.statValue} data-kind="loss">{fmtUsd(signal.maxLoss)}</div>
        </div>
        <div
          className={styles.stat}
          title="Risk/Reward = max loss ÷ max profit. Lower is better. Gate requires ≤ 3:1. Tight spreads (close strikes) → low R/R but small credit; wide spreads → high R/R."
        >
          <div className={styles.statLabel}>R/R</div>
          <div className={styles.statValue}>
            {signal.riskReward >= 999 ? '∞' : `${signal.riskReward.toFixed(2)}:1`}
          </div>
        </div>
        <div
          className={styles.stat}
          title="Spot price at expiry where P&L = 0. Call credit: short strike + credit. Put credit: short strike − credit. Anything past this point starts losing."
        >
          <div className={styles.statLabel}>Breakeven</div>
          <div className={styles.statValue}>{fmtUsd(signal.breakeven)}</div>
        </div>
      </div>

      <div className={styles.probBlock}>
        <div className={styles.probLabelRow}>
          <span
            className={styles.probLabel}
            title={
              signal.probabilityMethod === 'risk-neutral'
                ? 'Risk-neutral P(profit at expiry) = N(±d₂) using IV at the breakeven strike (Black-Scholes).'
                : 'Heuristic — bucketed spot/breakeven ratio. Used as fallback when smile IV is unavailable.'
            }
          >
            Success probability {signal.probabilityMethod === 'risk-neutral' ? '· N(d₂)' : '· heuristic'}
          </span>
          <span className={styles.probPct}>{probPct}%</span>
        </div>
        <div className={styles.probBar}>
          <div
            className={styles.probFill}
            style={{ width: `${Math.min(100, Math.max(0, probPct))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(SignalCard);
