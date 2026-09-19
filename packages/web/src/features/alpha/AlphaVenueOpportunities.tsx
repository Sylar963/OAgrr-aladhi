import type { SpreadKind } from '@lib/analytics/verticalSpread';
import { fmtUsd } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import { type SpreadCandidate, VERTICAL_LABELS, type VenueScan } from './spread-scanner';
import styles from './VenueRouterTable.module.css';

export default function AlphaVenueOpportunities({
  scans,
  kind,
  sellStrike,
  buyStrike,
  onSelect,
}: {
  scans: VenueScan[];
  kind: SpreadKind;
  sellStrike: number | null;
  buyStrike: number | null;
  onSelect: (candidate: SpreadCandidate) => void;
}) {
  return (
    <details className={styles.opportunities} open>
      <summary>Compare this spread / alternatives on each venue</summary>
      <p className={styles.subtitle}>
        Selected expiry and strategy only. Both legs stay on one venue. Ranked by model EV within
        your budget first—not a proven edge or a fill guarantee.
      </p>
      {scans.length === 0 && (
        <p className={styles.empty}>
          Enter your equity and valid sizing to compare venues. No candidates are shown when the
          chain is unavailable.
        </p>
      )}
      {scans.map((scan) => {
        const candidates = scan.candidates.filter((c) => c.kind === kind);
        const selected = candidates.find(
          (c) => c.sellStrike === sellStrike && c.buyStrike === buyStrike,
        );
        const alternatives = candidates.filter((c) => c.id !== selected?.id).slice(0, 3);
        const withinBudget = candidates.filter((c) => c.status !== 'over-budget');
        return (
          <div key={scan.venue} className={`${styles.leg} ${styles.opportunityVenue}`}>
            <strong className={styles.legHeading}>{VENUES[scan.venue]?.label ?? scan.venue}</strong>
            <span className={styles.subtitle}>
              {withinBudget.some((c) => c.status === 'review')
                ? 'Positive model estimate within budget — verify assumptions'
                : 'No positive model estimate within budget'}
            </span>
            {!selected && (
              <span className={styles.subtitle}>
                Your selected strikes have no eligible quote at this size on this venue.
              </span>
            )}
            {[...(selected ? [selected] : []), ...alternatives].map((c) => (
              <button
                type="button"
                key={c.id}
                className={styles.opportunity}
                onClick={() => onSelect(c)}
              >
                <span>
                  {c.id === selected?.id ? 'Selected strikes' : VERTICAL_LABELS[c.kind]} · sell{' '}
                  {c.sellStrike.toLocaleString()} / buy {c.buyStrike.toLocaleString()}
                </span>
                <span>
                  Max +{fmtUsd(c.maxProfit)} / −{fmtUsd(c.maxLoss)} · {c.riskPct.toFixed(2)}% equity
                </span>
                <span>
                  Model EV {fmtUsd(c.modelEdge)} ·{' '}
                  {c.status === 'over-budget'
                    ? 'OVER BUDGET'
                    : c.status === 'review'
                      ? 'REVIEW MODEL'
                      : c.status === 'no-model'
                        ? 'MODEL UNAVAILABLE'
                        : 'NO MODEL EDGE'}{' '}
                  · Load →
                </span>
              </button>
            ))}
            <details>
              <summary className={styles.subtitle}>Quote exclusions / coverage</summary>
              <p className={styles.subtitle}>
                Counts cover all four spread structures; inverse-settled contracts require a
                separate risk model.
              </p>
              {Object.entries(scan.rejected).map(([reason, count]) => (
                <div className={styles.subtitle} key={reason}>
                  {reason}: {count}
                </div>
              ))}
              {Object.keys(scan.rejected).length === 0 && (
                <p className={styles.subtitle}>No quote exclusions in this snapshot.</p>
              )}
            </details>
          </div>
        );
      })}
    </details>
  );
}
