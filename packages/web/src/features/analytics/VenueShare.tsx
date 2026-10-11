import type { EnrichedChainResponse } from '@shared/enriched';
import { fmtUsdCompact } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import { computeVenueRows, IV_GAP_MIN_DTE } from './positioning-utils';
import styles from './Positioning.module.css';

interface VenueShareProps {
  chains: EnrichedChainResponse[];
}

function fmtShare(v: number | null): string {
  return v == null ? '–' : `${(v * 100).toFixed(1)}%`;
}

function fmtGap(v: number | null): string {
  if (v == null) return '–';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(1)}vp`;
}

// Gaps within half a vol point are noise from mark-model differences.
function gapClass(v: number | null): string | undefined {
  if (v == null || Math.abs(v) < 0.5) return styles.dim;
  return v > 0 ? styles.neg : styles.pos;
}

export default function VenueShare({ chains }: VenueShareProps) {
  const rows = computeVenueRows(chains);
  const maxShare = Math.max(...rows.map((r) => r.oiShare ?? 0), 0.0001);

  return (
    <div className={styles.card} data-half>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>Venue Share & Pricing</span>
        <span className={styles.cardSubtitle}>
          Market share, activity, and ATM IV vs cross-venue median
        </span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>No venue data.</div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Venue</th>
                <th>OI Share</th>
                <th>OI</th>
                <th>Vol Share</th>
                <th>Turnover</th>
                <th>ATM IV Gap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = VENUES[r.venue];
                return (
                  <tr key={r.venue}>
                    <td>
                      <span className={styles.venueLabel}>
                        {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                        {meta?.shortLabel ?? r.venue}
                      </span>
                    </td>
                    <td className={styles.shareCell}>
                      <span
                        className={styles.shareFill}
                        style={{ width: `${((r.oiShare ?? 0) / maxShare) * 100}%` }}
                      />
                      <span className={`${styles.shareText} ${styles.strong}`}>
                        {fmtShare(r.oiShare)}
                      </span>
                    </td>
                    <td className={styles.dim}>{fmtUsdCompact(r.oiUsd)}</td>
                    <td>{fmtShare(r.volShare)}</td>
                    <td>{fmtShare(r.turnover)}</td>
                    <td
                      className={gapClass(r.ivGapVp)}
                      title={
                        r.ivGapSamples > 0 ? `averaged over ${r.ivGapSamples} expiries` : undefined
                      }
                    >
                      {fmtGap(r.ivGapVp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <span className={styles.footnote}>
        ATM IV gap: venue ATM mark IV minus the cross-venue median, averaged over expiries ≥
        {IV_GAP_MIN_DTE}d · red = richer (sell there), green = cheaper (buy there)
      </span>
    </div>
  );
}
