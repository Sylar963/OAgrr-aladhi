import { VenueDot } from '@components/ui';
import { fmtUsd } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import type { VenueId } from '@shared/enriched';
import type { ReactNode } from 'react';
import { VERTICAL_LABELS, type VerticalEconomics, type VerticalKind } from './vertical-pricing';
import styles from './VenueOpportunities.module.css';

const STATUS = {
  review: { label: 'CHECK', tone: 'review' },
  'no-edge': { label: 'WAIT', tone: 'avoid' },
  'over-budget': { label: 'TOO LARGE', tone: 'danger' },
  'no-model': { label: 'PRICE ONLY', tone: 'neutral' },
} as const;
const NO_PAIR = { label: 'NO PAIR', tone: 'empty' } as const;

export function OpportunitySection({
  title,
  subtitle,
  count,
  emptyHint,
  note,
  isEmpty,
  countLabel = 'live pairs',
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
  return (
    <details className={styles.opportunities} open>
      <summary className={styles.opportunitySummary}>
        <span>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <span className={styles.summaryCount}>
          {count} {countLabel}
        </span>
      </summary>
      {isEmpty ? (
        <div className={styles.scanEmpty}>
          <span className={styles.scanEmptyIcon}>◎</span>
          <strong>Scanner waiting</strong>
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
  children,
}: {
  venue: VenueId;
  kind: VerticalKind;
  kindCandidates: readonly VerticalEconomics[];
  pricedCount: number;
  rejected: Record<string, number>;
  children: ReactNode[];
}) {
  const best = kindCandidates.find((c) => c.status === 'review') ?? kindCandidates[0];
  const status = best ? STATUS[best.status] : NO_PAIR;
  const rejectedCount = Object.values(rejected).reduce((total, count) => total + count, 0);
  const checked = rejectedCount + pricedCount;
  const coverage = checked === 0 ? 0 : (pricedCount / checked) * 100;
  const topRejection = Object.entries(rejected).sort((a, b) => b[1] - a[1])[0];

  return (
    <section className={styles.venueCard} data-tone={status.tone}>
      <header className={styles.venueCardHeader}>
        <span className={styles.venueName}>
          <VenueDot venueId={venue} isBest={status.tone === 'review'} />
          {VENUES[venue]?.label ?? venue}
        </span>
        <span className={styles.venueState} data-tone={status.tone}>
          {status.label}
        </span>
      </header>

      <div className={styles.coverageRow}>
        <span>Executable coverage</span>
        <strong>{pricedCount} pairs</strong>
      </div>
      <div className={styles.coverageTrack}>
        <span style={{ width: `${Math.max(coverage, pricedCount > 0 ? 3 : 0)}%` }} />
      </div>

      {children.length === 0 ? (
        <div className={styles.noPair}>
          <span aria-hidden="true">∅</span>
          <div>
            <strong>No executable {VERTICAL_LABELS[kind].toLowerCase()}</strong>
            <small>
              {topRejection ? humanizeRejection(topRejection[0]) : 'No synchronized quotes'}
            </small>
          </div>
        </div>
      ) : (
        <div className={styles.candidateStack}>{children}</div>
      )}

      <details className={styles.coverageDetails}>
        <summary>Why quotes were filtered</summary>
        {Object.entries(rejected).map(([reason, count]) => (
          <div key={reason}>
            <span>{humanizeRejection(reason)}</span>
            <strong>{count}</strong>
          </div>
        ))}
        {Object.keys(rejected).length === 0 && <p>No exclusions in this snapshot.</p>}
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
        <span data-tone={status.tone}>{status.label}</span>
      </span>
      <span className={styles.strikeRoute}>
        <span>
          <i>S</i>
          {fmtStrike(candidate.sellStrike)}
        </span>
        <b />
        <span>
          <i>B</i>
          {fmtStrike(candidate.buyStrike)}
          {buyVenue && <VenueDot venueId={buyVenue} />}
        </span>
      </span>
      {detail}
      <span className={styles.candidateBalance}>
        <i className={styles.candidateLoss} style={{ width: `${100 - profitWidth}%` }} />
        <i className={styles.candidateProfit} style={{ width: `${profitWidth}%` }} />
      </span>
      <span className={styles.candidateNumbers}>
        <span>lose {fmtUsd(candidate.maxLoss)}</span>
        <span>EV {fmtUsd(candidate.modelEdge)}</span>
        <span>make {fmtUsd(candidate.maxProfit)}</span>
      </span>
      <span className={styles.loadLabel}>Load spread →</span>
    </button>
  );
}

function fmtStrike(value: number): string {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`
    : value.toFixed(0);
}

const REJECTION_LABELS: Record<string, string> = {
  'Missing buy ask / sell bid': 'No tradable bid or ask',
  'Unknown entry fees': 'Fee data missing',
  'Stale or missing timestamp': 'Quote too old',
  'Leg timestamps differ by over 2s': 'Leg quotes not synchronized',
  'Quantity below minimum or off step': 'Size below venue minimum',
  'Insufficient displayed size': 'Not enough size at quote',
  'No positive payoff after costs': 'Costs consume the payoff',
  'Missing execution metadata / fees': 'Execution data missing',
  'Inverse settlement needs separate risk model': 'Unsupported settlement type',
  'Settlement mismatch': 'Leg settlement mismatch',
  'Crossed leg quote': 'Invalid crossed quote',
  'Enable a second venue to route across venues': 'Enable a second venue',
};

function humanizeRejection(reason: string): string {
  return REJECTION_LABELS[reason] ?? reason;
}
