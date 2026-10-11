import type { EnrichedChainResponse } from '@shared/enriched';
import { fmtNum, fmtPct, fmtUsdCompact, formatExpiry } from '@lib/format';
import { computeExpiryRows, NEAR_EXPIRY_DAYS } from './positioning-utils';
import styles from './Positioning.module.css';

interface ExpiryCalendarProps {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
}

function pcClass(v: number | null): string | undefined {
  if (v == null) return styles.dim;
  if (v > 1.3) return styles.neg;
  if (v < 0.7) return styles.pos;
  return undefined;
}

export default function ExpiryCalendar({ chains, spotPrice }: ExpiryCalendarProps) {
  const rows = computeExpiryRows(chains, spotPrice);
  const maxShare = Math.max(...rows.map((r) => r.oiShare ?? 0), 0.0001);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>Expiry Calendar</span>
        <span className={styles.cardSubtitle}>
          Where OI rolls off, where it may pin, and which expiries are active · USD notional
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>No open interest.</div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Expiry</th>
                <th>OI</th>
                <th>Share</th>
                <th>P/C $</th>
                <th>Max Pain</th>
                <th>vs Fwd</th>
                <th>Exp. Move</th>
                <th>24h Vol</th>
                <th>Turnover</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.expiry} data-near={r.dte <= NEAR_EXPIRY_DAYS}>
                  <td className={styles.strong}>
                    {formatExpiry(r.expiry)}
                    <span className={styles.dteBadge} data-urgent={r.dte <= 1}>
                      {r.dte}d
                    </span>
                  </td>
                  <td className={styles.strong}>{fmtUsdCompact(r.oiUsd)}</td>
                  <td className={styles.shareCell}>
                    <span
                      className={styles.shareFill}
                      style={{ width: `${((r.oiShare ?? 0) / maxShare) * 100}%` }}
                    />
                    <span className={styles.shareText}>
                      {r.oiShare == null ? '–' : `${(r.oiShare * 100).toFixed(1)}%`}
                    </span>
                  </td>
                  <td className={pcClass(r.pcOi)}>{r.pcOi == null ? '–' : r.pcOi.toFixed(2)}</td>
                  <td>{r.maxPain == null ? '–' : fmtNum(r.maxPain, 0)}</td>
                  <td className={styles.dim}>{fmtPct(r.maxPainDistPct, 1)}</td>
                  <td>
                    {r.expectedMove == null ? (
                      '–'
                    ) : (
                      <>
                        ±{fmtNum(r.expectedMove, 0)}{' '}
                        <span className={styles.dim}>
                          ({r.expectedMovePct?.toFixed(1)}%)
                        </span>
                      </>
                    )}
                  </td>
                  <td className={styles.dim}>{fmtUsdCompact(r.volUsd)}</td>
                  <td>{r.turnover == null ? '–' : `${(r.turnover * 100).toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <span className={styles.footnote}>
        Max pain: settlement minimising holder payout, USD-weighted · Exp. move: ATM straddle
        cross-checked with ATM IV · Turnover: 24h volume / OI (high = active, low = stale) · Marked
        rows expire within {NEAR_EXPIRY_DAYS}d
      </span>
    </div>
  );
}
