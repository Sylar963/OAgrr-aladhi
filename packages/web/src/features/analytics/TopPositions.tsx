import type { EnrichedChainResponse } from '@shared/enriched';
import { fmtNum, fmtPct, fmtUsdCompact, formatExpiry } from '@lib/format';
import { useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import { computeTopPositions } from './positioning-utils';
import { positioningMessages } from './i18n';
import styles from './Positioning.module.css';

interface TopPositionsProps {
  chains: EnrichedChainResponse[];
  spotPrice: number | null;
}

export default function TopPositions({ chains, spotPrice }: TopPositionsProps) {
  const t = useT(positioningMessages);
  const rows = computeTopPositions(chains, spotPrice);

  return (
    <div className={styles.card} data-half>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{t('topTitle')}</span>
        <span className={styles.cardSubtitle}>{t('topSubtitle')}</span>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>{t('noOpenInterest')}</div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('contract')}</th>
                <th>{t('vsSpot')}</th>
                <th>{t('oi')}</th>
                <th>{t('share')}</th>
                <th>{t('vol24h')}</th>
                <th>{t('mainVenue')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = r.topVenue ? VENUES[r.topVenue] : undefined;
                return (
                  <tr key={`${r.expiry}-${r.strike}-${r.right}`}>
                    <td>
                      <span className={styles.strong}>{fmtNum(r.strike, 0)}</span>{' '}
                      <span className={r.right === 'call' ? styles.call : styles.put}>
                        {r.right === 'call' ? 'C' : 'P'}
                      </span>{' '}
                      <span className={styles.dim}>{formatExpiry(r.expiry)}</span>
                    </td>
                    <td className={styles.dim}>{fmtPct(r.moneynessPct, 1)}</td>
                    <td className={styles.strong}>{fmtUsdCompact(r.oiUsd)}</td>
                    <td>{r.oiShare == null ? '–' : `${(r.oiShare * 100).toFixed(1)}%`}</td>
                    <td className={styles.dim}>{fmtUsdCompact(r.volUsd)}</td>
                    <td>
                      {r.topVenue ? (
                        <span className={styles.venueLabel}>
                          {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                          {meta?.shortLabel ?? r.topVenue}
                          <span className={styles.dim}>
                            {r.topVenueShare == null
                              ? ''
                              : `${Math.round(r.topVenueShare * 100)}%`}
                          </span>
                        </span>
                      ) : (
                        '–'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
