import { fmtUsd } from '@lib/format';
import type { SpreadSignal } from '@lib/analytics/verticalSpread';

import styles from './SignalCard.module.css';

interface Props {
  signal: SpreadSignal | null;
  label?: string;
}

export default function SignalCard({ signal, label = 'Executable (best routing)' }: Props) {
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
      </div>

      <div className={styles.pillRow}>
        <span className={styles.pill} data-signal={signal.signal}>
          {signal.signal}
        </span>
        <span className={styles.reasoning}>{signal.reasoning}</span>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Net credit</div>
          <div className={styles.statValue} data-kind="credit">{fmtUsd(signal.netCredit)}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Max loss</div>
          <div className={styles.statValue} data-kind="loss">{fmtUsd(signal.maxLoss)}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>R/R</div>
          <div className={styles.statValue}>
            {signal.riskReward >= 999 ? '∞' : `${signal.riskReward.toFixed(2)}:1`}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Breakeven</div>
          <div className={styles.statValue}>{fmtUsd(signal.breakeven)}</div>
        </div>
      </div>

      <div className={styles.probBlock}>
        <div className={styles.probLabelRow}>
          <span className={styles.probLabel} title="Heuristic success probability — not N(d2)">
            Success probability *
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
