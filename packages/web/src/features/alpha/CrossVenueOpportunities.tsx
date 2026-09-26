import { fmtUsd } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import styles from './CrossVenueOpportunities.module.css';
import type { CrossVenueCandidate, CrossVenueScan } from './cross-venue-scanner';
import { CandidateRow, OpportunityCard, OpportunitySection } from './OpportunityCard';
import { VERTICAL_LABELS, type VerticalKind } from './vertical-pricing';

export default function CrossVenueOpportunities({
  scans,
  kind,
  sellStrike,
  buyStrike,
  loadedId,
  onSelect,
}: {
  scans: CrossVenueScan[];
  kind: VerticalKind;
  sellStrike: number | null;
  buyStrike: number | null;
  loadedId: string | null;
  onSelect: (candidate: CrossVenueCandidate) => void;
}) {
  const visibleCount = scans.reduce(
    (total, scan) => total + scan.candidates.filter((candidate) => candidate.kind === kind).length,
    0,
  );

  return (
    <OpportunitySection
      title="Cross-venue spreads"
      subtitle="Short leg on this venue, long leg on another"
      count={visibleCount}
      emptyHint="Enter account equity and enable at least two venues."
      note="Each card is the venue holding the short leg. Legs fill independently (no combo order), fees are standalone taker fees on each venue, and the short venue margins its leg as a naked short. Only routes that beat the best same-venue price are shown."
      isEmpty={scans.length === 0}
    >
      {scans.map((scan) => {
        const candidates = scan.candidates.filter((candidate) => candidate.kind === kind);
        // One card holds a route per buy venue at the same strikes; prefer the loaded one.
        const selected =
          candidates.find((c) => c.id === loadedId) ??
          candidates.find((c) => c.sellStrike === sellStrike && c.buyStrike === buyStrike);
        const alternatives = candidates.filter((c) => c.id !== selected?.id).slice(0, 2);
        return (
          <OpportunityCard
            key={scan.sellVenue}
            venue={scan.sellVenue}
            kind={kind}
            kindCandidates={candidates}
            pricedCount={scan.candidates.length}
            rejected={scan.rejected}
          >
            {[...(selected ? [selected] : []), ...alternatives].map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                title={rowTitle(candidate, selected, loadedId)}
                selected={candidate === selected}
                buyVenue={candidate.buyVenue}
                detail={<RouteFees candidate={candidate} />}
                onClick={() => onSelect(candidate)}
              />
            ))}
          </OpportunityCard>
        );
      })}
    </OpportunitySection>
  );
}

function rowTitle(
  candidate: CrossVenueCandidate,
  selected: CrossVenueCandidate | undefined,
  loadedId: string | null,
): string {
  if (candidate !== selected) return VERTICAL_LABELS[candidate.kind];
  return candidate.id === loadedId ? 'Selected' : 'Your strikes';
}

function RouteFees({ candidate }: { candidate: CrossVenueCandidate }) {
  return (
    <span className={styles.routeFees}>
      <span>
        fee {fmtUsd(candidate.legFees.sell)} sell · {fmtUsd(candidate.legFees.buy)} buy @{' '}
        {VENUES[candidate.buyVenue]?.label ?? candidate.buyVenue}
      </span>
      <span data-tone={candidate.improvement == null ? 'neutral' : 'profit'}>
        {candidate.improvement == null
          ? 'no same-venue pair'
          : `+${fmtUsd(candidate.improvement)} vs same`}
      </span>
    </span>
  );
}
