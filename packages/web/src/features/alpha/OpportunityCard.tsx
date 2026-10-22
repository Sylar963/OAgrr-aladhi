import { VenueDot } from '@components/ui';
import { fmtStrikeShort, fmtUsd } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import type { VenueId } from '@shared/enriched';
import { defineMessages, useT } from '@lib/i18n';
import type { ReactNode } from 'react';
import { alphaMessages, humanizeRejection, VERTICAL_LABEL_KEYS } from './i18n';
import type { MarkIndicative } from './spread-scanner';
import type { VerticalEconomics, VerticalKind } from './vertical-pricing';
import styles from './VenueOpportunities.module.css';

const messages = defineMessages(
  {
    statusCheck: 'CHECK',
    statusWait: 'WAIT',
    statusTooLarge: 'TOO LARGE',
    statusPriceOnly: 'PRICE ONLY',
    statusNoPair: 'NO PAIR',
    statusMarkOnly: 'MARK ONLY',
    livePairs: 'live pairs',
    scannerWaiting: 'Scanner waiting',
    sizePerLeg: 'Size per leg',
    executableCoverage: 'Executable coverage',
    pairsCount: '{n} pairs',
    markOnlyTitle: 'Mark only · no orders on {venue}',
    atMark: 'At mark, before fees: {side} {premium} · max loss {maxLoss}. Reference only, not executable.',
    credit: 'credit',
    debit: 'debit',
    marksNoQuote: '{venue} publishes marks and IV for these options but no bid or ask.',
    noExecutable: 'No executable {kind}',
    noSyncQuotes: 'No synchronized quotes',
    whyFiltered: 'Why quotes were filtered',
    noExclusions: 'No exclusions in this snapshot.',
    lose: 'lose {value}',
    ev: 'EV {value}',
    make: 'make {value}',
    loadSpread: 'Load spread →',
  },
  {
    statusCheck: 'REVISAR',
    statusWait: 'ESPERAR',
    statusTooLarge: 'DEMASIADO GRANDE',
    statusPriceOnly: 'SOLO PRECIO',
    statusNoPair: 'SIN PAR',
    statusMarkOnly: 'SOLO MARK',
    livePairs: 'pares en vivo',
    scannerWaiting: 'Escáner en espera',
    sizePerLeg: 'Tamaño por pata',
    executableCoverage: 'Cobertura ejecutable',
    pairsCount: '{n} pares',
    markOnlyTitle: 'Solo mark · sin órdenes en {venue}',
    atMark: 'A mark, antes de comisiones: {side} {premium} · pérdida máx. {maxLoss}. Solo referencia, no ejecutable.',
    credit: 'crédito',
    debit: 'débito',
    marksNoQuote: '{venue} publica mark e IV para estas opciones, pero no bid ni ask.',
    noExecutable: 'Ningún {kind} ejecutable',
    noSyncQuotes: 'Sin cotizaciones sincronizadas',
    whyFiltered: 'Por qué se filtraron cotizaciones',
    noExclusions: 'Sin exclusiones en esta instantánea.',
    lose: 'pierdes {value}',
    ev: 'EV {value}',
    make: 'ganas {value}',
    loadSpread: 'Cargar spread →',
  },
);

type MessageKey = keyof typeof messages.en;

const STATUS = {
  review: { label: 'statusCheck', tone: 'review' },
  'no-edge': { label: 'statusWait', tone: 'avoid' },
  'over-budget': { label: 'statusTooLarge', tone: 'danger' },
  'no-model': { label: 'statusPriceOnly', tone: 'neutral' },
} as const satisfies Record<string, { label: MessageKey; tone: string }>;
const NO_PAIR = { label: 'statusNoPair', tone: 'empty' } as const;
const MARK_ONLY = { label: 'statusMarkOnly', tone: 'neutral' } as const;

export function OpportunitySection({
  title,
  subtitle,
  count,
  emptyHint,
  note,
  isEmpty,
  countLabel,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  countLabel?: string;
  emptyHint: string;
  note: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  const t = useT(messages);
  return (
    <details className={styles.opportunities} open>
      <summary className={styles.opportunitySummary}>
        <span>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <span className={styles.summaryCount}>
          {count} {countLabel ?? t('livePairs')}
        </span>
      </summary>
      {isEmpty ? (
        <div className={styles.scanEmpty}>
          <span className={styles.scanEmptyIcon}>◎</span>
          <strong>{t('scannerWaiting')}</strong>
          <span>{emptyHint}</span>
        </div>
      ) : (
        <div className={styles.venueGrid}>{children}</div>
      )}
      <p className={styles.opportunityNote}>{note}</p>
    </details>
  );
}

/**
 * One venue's card: status from the best candidate of `kind`, coverage over every
 * priced pair, and the filtered-quote breakdown. Rows are supplied by the caller.
 */
export function OpportunityCard({
  venue,
  kind,
  kindCandidates,
  pricedCount,
  rejected,
  sizeLabel,
  markOnly = false,
  indicative = null,
  children,
}: {
  venue: VenueId;
  kind: VerticalKind;
  kindCandidates: readonly VerticalEconomics[];
  pricedCount: number;
  rejected: Record<string, number>;
  /** Size this card was priced at, when it differs per venue. */
  sizeLabel?: string;
  markOnly?: boolean;
  /** Selected strikes valued at this venue's marks; shown only for a mark-only venue. */
  indicative?: MarkIndicative | null;
  children: ReactNode[];
}) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const best = kindCandidates.find((c) => c.status === 'review') ?? kindCandidates[0];
  const status = best ? STATUS[best.status] : markOnly ? MARK_ONLY : NO_PAIR;
  const venueLabel = VENUES[venue]?.label ?? venue;
  const rejectedCount = Object.values(rejected).reduce((total, count) => total + count, 0);
  const checked = rejectedCount + pricedCount;
  const coverage = checked === 0 ? 0 : (pricedCount / checked) * 100;
  const topRejection = Object.entries(rejected).sort((a, b) => b[1] - a[1])[0];

  return (
    <section className={styles.venueCard} data-tone={status.tone}>
      <header className={styles.venueCardHeader}>
        <span className={styles.venueName}>
          <VenueDot venueId={venue} isBest={status.tone === 'review'} />
          {venueLabel}
        </span>
        <span className={styles.venueState} data-tone={status.tone}>
          {t(status.label)}
        </span>
      </header>

      {sizeLabel && (
        <div className={styles.coverageRow}>
          <span>{t('sizePerLeg')}</span>
          <strong>{sizeLabel}</strong>
        </div>
      )}
      <div className={styles.coverageRow}>
        <span>{t('executableCoverage')}</span>
        <strong>{t('pairsCount', { n: pricedCount })}</strong>
      </div>
      <div className={styles.coverageTrack}>
        <span style={{ width: `${Math.max(coverage, pricedCount > 0 ? 3 : 0)}%` }} />
      </div>

      {children.length === 0 && markOnly ? (
        <div className={styles.noPair}>
          <span aria-hidden="true">≈</span>
          <div>
            <strong>{t('markOnlyTitle', { venue: venueLabel })}</strong>
            <small>
              {indicative
                ? t('atMark', {
                    side: t(indicative.grossPremium >= 0 ? 'credit' : 'debit'),
                    premium: fmtUsd(Math.abs(indicative.grossPremium)),
                    maxLoss: fmtUsd(indicative.maxLoss),
                  })
                : t('marksNoQuote', { venue: venueLabel })}
            </small>
          </div>
        </div>
      ) : children.length === 0 ? (
        <div className={styles.noPair}>
          <span aria-hidden="true">∅</span>
          <div>
            <strong>{t('noExecutable', { kind: ta(VERTICAL_LABEL_KEYS[kind]).toLowerCase() })}</strong>
            <small>
              {topRejection ? humanizeRejection(topRejection[0], ta) : t('noSyncQuotes')}
            </small>
          </div>
        </div>
      ) : (
        <div className={styles.candidateStack}>{children}</div>
      )}

      <details className={styles.coverageDetails}>
        <summary>{t('whyFiltered')}</summary>
        {Object.entries(rejected).map(([reason, count]) => (
          <div key={reason}>
            <span>{humanizeRejection(reason, ta)}</span>
            <strong>{count}</strong>
          </div>
        ))}
        {Object.keys(rejected).length === 0 && <p>{t('noExclusions')}</p>}
      </details>
    </section>
  );
}

export function CandidateRow({
  candidate,
  title,
  selected,
  buyVenue,
  detail,
  onClick,
}: {
  candidate: VerticalEconomics;
  title: string;
  selected: boolean;
  /** Shown beside the buy strike when the long leg fills on another venue. */
  buyVenue?: VenueId;
  detail?: ReactNode;
  onClick: () => void;
}) {
  const t = useT(messages);
  const status = STATUS[candidate.status];
  const total = candidate.maxProfit + candidate.maxLoss;
  const profitWidth = (candidate.maxProfit / total) * 100;
  return (
    <button
      type="button"
      className={styles.candidateRow}
      data-selected={selected}
      data-tone={status.tone}
      onClick={onClick}
    >
      <span className={styles.candidateTopline}>
        <strong>{title}</strong>
        <span data-tone={status.tone}>{t(status.label)}</span>
      </span>
      <span className={styles.strikeRoute}>
        <span>
          <i>S</i>
          {fmtStrikeShort(candidate.sellStrike)}
        </span>
        <b />
        <span>
          <i>B</i>
          {fmtStrikeShort(candidate.buyStrike)}
          {buyVenue && <VenueDot venueId={buyVenue} />}
        </span>
      </span>
      {detail}
      <span className={styles.candidateBalance}>
        <i className={styles.candidateLoss} style={{ width: `${100 - profitWidth}%` }} />
        <i className={styles.candidateProfit} style={{ width: `${profitWidth}%` }} />
      </span>
      <span className={styles.candidateNumbers}>
        <span>{t('lose', { value: fmtUsd(candidate.maxLoss) })}</span>
        <span>{t('ev', { value: fmtUsd(candidate.modelEdge) })}</span>
        <span>{t('make', { value: fmtUsd(candidate.maxProfit) })}</span>
      </span>
      <span className={styles.loadLabel}>{t('loadSpread')}</span>
    </button>
  );
}
