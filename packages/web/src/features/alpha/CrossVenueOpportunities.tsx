import { fmtUsd } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import styles from './CrossVenueOpportunities.module.css';
import type { CrossVenueCandidate, CrossVenueScan } from './cross-venue-scanner';
import { alphaMessages, type AlphaT, VERTICAL_LABEL_KEYS } from './i18n';
import { CandidateRow, OpportunityCard, OpportunitySection } from './OpportunityCard';
import type { VerticalKind } from './vertical-pricing';

const messages = defineMessages(
  {
    title: 'Cross-venue spreads',
    subtitle: 'Short leg on this venue, long leg on another',
    emptyHint: 'Enter account equity and enable at least two venues.',
    note: 'Each card is the venue holding the short leg. Legs fill independently (no combo order), fees are standalone taker fees on each venue, and the short venue margins its leg as a naked short. Only routes that beat the best same-venue price are shown.',
    yourStrikes: 'Your strikes',
    fees: 'fee {sell} sell · {buy} buy @ {venue}',
    noSamePair: 'no same-venue pair',
    vsSame: '+{value} vs same',
  },
  {
    title: 'Spreads entre exchanges',
    subtitle: 'Pata short en este exchange, pata long en otro',
    emptyHint: 'Ingresa el capital de la cuenta y activa al menos dos exchanges.',
    note: 'Cada tarjeta es el exchange que tiene la pata short. Las patas se ejecutan por separado (sin orden combo), las comisiones son taker individuales en cada exchange y el exchange short margina su pata como short descubierto. Solo se muestran rutas que superan el mejor precio en un solo exchange.',
    yourStrikes: 'Tus strikes',
    fees: 'comisión {sell} venta · {buy} compra @ {venue}',
    noSamePair: 'sin par en un solo exchange',
    vsSame: '+{value} vs mismo exchange',
  },
);

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
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const visibleCount = scans.reduce(
    (total, scan) => total + scan.candidates.filter((candidate) => candidate.kind === kind).length,
    0,
  );

  return (
    <OpportunitySection
      title={t('title')}
      subtitle={t('subtitle')}
      count={visibleCount}
      emptyHint={t('emptyHint')}
      note={t('note')}
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
                title={rowTitle(candidate, selected, loadedId, ta, t('yourStrikes'))}
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
  ta: AlphaT,
  yourStrikes: string,
): string {
  if (candidate !== selected) return ta(VERTICAL_LABEL_KEYS[candidate.kind]);
  return candidate.id === loadedId ? ta('selected') : yourStrikes;
}

function RouteFees({ candidate }: { candidate: CrossVenueCandidate }) {
  const t = useT(messages);
  return (
    <span className={styles.routeFees}>
      <span>
        {t('fees', {
          sell: fmtUsd(candidate.legFees.sell),
          buy: fmtUsd(candidate.legFees.buy),
          venue: VENUES[candidate.buyVenue]?.label ?? candidate.buyVenue,
        })}
      </span>
      <span data-tone={candidate.improvement == null ? 'neutral' : 'profit'}>
        {candidate.improvement == null
          ? t('noSamePair')
          : t('vsSame', { value: fmtUsd(candidate.improvement) })}
      </span>
    </span>
  );
}
