import { defineMessages, useT } from '@lib/i18n';
import type { VenueId } from '@shared/enriched';
import { alphaMessages, VERTICAL_LABEL_KEYS } from './i18n';
import { CandidateRow, OpportunityCard, OpportunitySection } from './OpportunityCard';
import type { MarkIndicative } from './spread-scanner';
import { formatQuantity } from './venue-sizing';
import type { SpreadCandidate, VenueScan } from './spread-scanner';
import type { VerticalKind } from './vertical-pricing';
import styles from './VenueOpportunities.module.css';

const messages = defineMessages(
  {
    title: 'Same-venue spreads',
    subtitle: 'Both legs execute on one venue',
    emptyHint: 'Enter account equity to map each venue.',
    note: 'Green means “inspect,” not “buy.” Ranking uses live bid/ask, known fees, your size and your loss limit; within budget, rows are ordered by EV per standard deviation of expiry P&L.',
    settlesIn: 'settles in {underlying}',
    premium: '{value} {underlying} premium',
  },
  {
    title: 'Spreads en un solo exchange',
    subtitle: 'Ambas patas se ejecutan en un exchange',
    emptyHint: 'Ingresa el capital de la cuenta para mapear cada exchange.',
    note: 'Verde significa “revisar”, no “comprar”. El ranking usa bid/ask en vivo, comisiones conocidas, tu tamaño y tu límite de pérdida; dentro del presupuesto, las filas se ordenan por EV por desviación estándar del P&L al vencimiento.',
    settlesIn: 'liquida en {underlying}',
    premium: 'prima de {value} {underlying}',
  },
);

export default function AlphaVenueOpportunities({
  scans,
  kind,
  underlying,
  quantities,
  indicativeFor,
  sellStrike,
  buyStrike,
  onSelect,
}: {
  scans: VenueScan[];
  kind: VerticalKind;
  underlying: string;
  /** Per-venue auto size; absent when one size applies to every venue. */
  quantities?: Partial<Record<VenueId, number>>;
  indicativeFor?: (venue: VenueId) => MarkIndicative | null;
  sellStrike: number | null;
  buyStrike: number | null;
  onSelect: (candidate: SpreadCandidate) => void;
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
        const selected = candidates.find(
          (candidate) => candidate.sellStrike === sellStrike && candidate.buyStrike === buyStrike,
        );
        const alternatives = candidates.filter((c) => c.id !== selected?.id).slice(0, 2);
        const quantity = quantities?.[scan.venue];
        return (
          <OpportunityCard
            key={scan.venue}
            venue={scan.venue}
            {...(quantity != null && { sizeLabel: `${formatQuantity(quantity)} ${underlying}` })}
            markOnly={scan.markOnly}
            indicative={scan.markOnly ? (indicativeFor?.(scan.venue) ?? null) : null}
            kind={kind}
            kindCandidates={candidates}
            pricedCount={scan.candidates.length}
            rejected={scan.rejected}
          >
            {[...(selected ? [selected] : []), ...alternatives].map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                title={ta(candidate === selected ? 'selected' : VERTICAL_LABEL_KEYS[candidate.kind])}
                selected={candidate === selected}
                detail={
                  candidate.basePremium != null && (
                    <span className={styles.settlementNote}>
                      <span>{t('settlesIn', { underlying })}</span>
                      <span>
                        {t('premium', {
                          value: `${candidate.basePremium > 0 ? '+' : ''}${candidate.basePremium.toFixed(4)}`,
                          underlying,
                        })}
                      </span>
                    </span>
                  )
                }
                onClick={() => onSelect(candidate)}
              />
            ))}
          </OpportunityCard>
        );
      })}
    </OpportunitySection>
  );
}
