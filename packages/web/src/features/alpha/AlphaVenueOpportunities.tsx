import { CandidateRow, OpportunityCard, OpportunitySection } from './OpportunityCard';
import type { SpreadCandidate, VenueScan } from './spread-scanner';
import { VERTICAL_LABELS, type VerticalKind } from './vertical-pricing';

export default function AlphaVenueOpportunities({
  scans,
  kind,
  sellStrike,
  buyStrike,
  onSelect,
}: {
  scans: VenueScan[];
  kind: VerticalKind;
  sellStrike: number | null;
  buyStrike: number | null;
  onSelect: (candidate: SpreadCandidate) => void;
}) {
  const visibleCount = scans.reduce(
    (total, scan) => total + scan.candidates.filter((candidate) => candidate.kind === kind).length,
    0,
  );

  return (
    <OpportunitySection
      title="Same-venue spreads"
      subtitle="Both legs execute on one venue"
      count={visibleCount}
      emptyHint="Enter account equity to map each venue."
      note="Green means “inspect,” not “buy.” Ranking uses live bid/ask, known fees, your size and your loss limit."
      isEmpty={scans.length === 0}
    >
      {scans.map((scan) => {
        const candidates = scan.candidates.filter((candidate) => candidate.kind === kind);
        const selected = candidates.find(
          (candidate) => candidate.sellStrike === sellStrike && candidate.buyStrike === buyStrike,
        );
        const alternatives = candidates.filter((c) => c.id !== selected?.id).slice(0, 2);
        return (
          <OpportunityCard
            key={scan.venue}
            venue={scan.venue}
            kind={kind}
            kindCandidates={candidates}
            pricedCount={scan.candidates.length}
            rejected={scan.rejected}
          >
            {[...(selected ? [selected] : []), ...alternatives].map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                title={candidate === selected ? 'Selected' : VERTICAL_LABELS[candidate.kind]}
                selected={candidate === selected}
                onClick={() => onSelect(candidate)}
              />
            ))}
          </OpportunityCard>
        );
      })}
    </OpportunitySection>
  );
}
