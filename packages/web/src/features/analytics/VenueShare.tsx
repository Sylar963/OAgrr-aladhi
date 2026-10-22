import type { EnrichedChainResponse } from '@shared/enriched';
import { fmtUsdCompact } from '@lib/format';
import { useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { computeVenueRows, IV_GAP_MIN_DTE } from './positioning-utils';
import { positioningMessages } from './i18n';
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
  const t = useT(positioningMessages);
  const rows = computeVenueRows(chains);
  const maxShare = Math.max(...rows.map((r) => r.oiShare ?? 0), 0.0001);

  return (
    <div className={styles.card} data-half>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{t('venueTitle')}</span>
        <span className={styles.cardSubtitle}>{t('venueSubtitle')}</span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>{t('noVenueData')}</div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('venue')}</th>
                <th>{t('oiShare')}</th>
                <th>{t('oi')}</th>
                <th>{t('volShare')}</th>
                <th>{t('turnover')}</th>
                <th>{t('atmIvGap')}</th>
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
                        r.ivGapSamples > 0 ? t('gapSamples', { n: r.ivGapSamples }) : undefined
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

      <span className={styles.footnote}>{t('venueFootnote', { n: IV_GAP_MIN_DTE })}</span>
    </div>
  );
}
