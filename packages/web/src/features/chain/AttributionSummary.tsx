import type { AttributionSummary } from './pnl-attribution.js';

import styles from './AttributionSummary.module.css';

interface Props {
  summary: AttributionSummary;
  priceCurrency: string;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function fmtPL(x: number, currency: string): string {
  const abs = Math.abs(x);
  const prefix = x < 0 ? '−' : '';
  if (currency === 'BTC' || currency === 'ETH') {
    return `${prefix}${abs.toFixed(4)} ${currency}`;
  }
  if (abs >= 1) return `${prefix}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
  return `${prefix}${abs.toFixed(4)} ${currency}`;
}

export function AttributionSummary({ summary, priceCurrency }: Props) {
  return (
    <div className={styles.strip}>
      <span className={styles.total}>
        PL {fmtPL(summary.totalPL, priceCurrency)}
      </span>
      <span className={styles.chip} data-greek="delta">Δ {fmtPct(summary.deltaPct)}</span>
      <span className={styles.chip} data-greek="gamma">Γ {fmtPct(summary.gammaPct)}</span>
      <span className={styles.chip} data-greek="theta">Θ {fmtPct(summary.thetaPct)}</span>
      <span className={styles.chip} data-greek="vega">V {fmtPct(summary.vegaPct)}</span>
      <span className={styles.chip} data-greek="residual">res {fmtPct(summary.residualPct)}</span>
    </div>
  );
}
