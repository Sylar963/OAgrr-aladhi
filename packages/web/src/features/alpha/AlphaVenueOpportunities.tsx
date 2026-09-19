import { VenueDot } from '@components/ui';
import type { SpreadKind } from '@lib/analytics/verticalSpread';
import { fmtUsd } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import { type SpreadCandidate, VERTICAL_LABELS, type VenueScan } from './spread-scanner';
import styles from './VenueRouterTable.module.css';

const STATUS = {
  review: { label: 'CHECK', tone: 'review' },
  'no-edge': { label: 'WAIT', tone: 'avoid' },
  'over-budget': { label: 'TOO LARGE', tone: 'danger' },
  'no-model': { label: 'PRICE ONLY', tone: 'neutral' },
} as const;

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
  const visibleCount = scans.reduce(
    (total, scan) => total + scan.candidates.filter((candidate) => candidate.kind === kind).length,
    0,
  );

  return (
    <details className={styles.opportunities} open>
      <summary className={styles.opportunitySummary}>
        <span>
          <strong>Same-venue spreads</strong>
          <small>Both legs execute on one venue</small>
        </span>
        <span className={styles.summaryCount}>{visibleCount} live pairs</span>
      </summary>

      {scans.length === 0 ? (
        <div className={styles.scanEmpty}>
          <span className={styles.scanEmptyIcon}>◎</span>
          <strong>Scanner waiting</strong>
          <span>Enter account equity to map each venue.</span>
        </div>
      ) : (
        <div className={styles.venueGrid}>
          {scans.map((scan) => (
            <VenueOpportunity
              key={scan.venue}
              scan={scan}
              kind={kind}
              sellStrike={sellStrike}
              buyStrike={buyStrike}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      <p className={styles.opportunityNote}>
        Green means “inspect,” not “buy.” Ranking uses live bid/ask, known fees, your size and your
        loss limit.
      </p>
    </details>
  );
}

function VenueOpportunity({
  scan,
  kind,
  sellStrike,
  buyStrike,
  onSelect,
}: {
  scan: VenueScan;
  kind: SpreadKind;
  sellStrike: number | null;
  buyStrike: number | null;
  onSelect: (candidate: SpreadCandidate) => void;
}) {
  const candidates = scan.candidates.filter((candidate) => candidate.kind === kind);
  const selected = candidates.find(
    (candidate) => candidate.sellStrike === sellStrike && candidate.buyStrike === buyStrike,
  );
  const alternatives = candidates.filter((candidate) => candidate.id !== selected?.id).slice(0, 2);
  const visible = [...(selected ? [selected] : []), ...alternatives];
  const best = candidates.find((candidate) => candidate.status === 'review') ?? candidates[0];
  const status = best ? STATUS[best.status] : { label: 'NO PAIR', tone: 'empty' };
  const rejected = Object.values(scan.rejected).reduce((total, count) => total + count, 0);
  const checked = rejected + scan.candidates.length;
  const coverage = checked === 0 ? 0 : (scan.candidates.length / checked) * 100;
  const topRejection = Object.entries(scan.rejected).sort((a, b) => b[1] - a[1])[0];

  return (
    <section className={styles.venueCard} data-tone={status.tone}>
      <header className={styles.venueCardHeader}>
        <span className={styles.venueName}>
          <VenueDot venueId={scan.venue} isBest={status.tone === 'review'} />
          {VENUES[scan.venue]?.label ?? scan.venue}
        </span>
        <span className={styles.venueState} data-tone={status.tone}>
          {status.label}
        </span>
      </header>

      <div className={styles.coverageRow}>
        <span>Executable coverage</span>
        <strong>{scan.candidates.length} pairs</strong>
      </div>
      <div className={styles.coverageTrack}>
        <span style={{ width: `${Math.max(coverage, scan.candidates.length > 0 ? 3 : 0)}%` }} />
      </div>

      {visible.length === 0 ? (
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
        <div className={styles.candidateStack}>
          {visible.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              selected={candidate.id === selected?.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      <details className={styles.coverageDetails}>
        <summary>Why quotes were filtered</summary>
        {Object.entries(scan.rejected).map(([reason, count]) => (
          <div key={reason}>
            <span>{humanizeRejection(reason)}</span>
            <strong>{count}</strong>
          </div>
        ))}
        {Object.keys(scan.rejected).length === 0 && <p>No exclusions in this snapshot.</p>}
      </details>
    </section>
  );
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: SpreadCandidate;
  selected: boolean;
  onSelect: (candidate: SpreadCandidate) => void;
}) {
  const status = STATUS[candidate.status];
  const total = candidate.maxProfit + candidate.maxLoss;
  const profitWidth = (candidate.maxProfit / total) * 100;
  const lossWidth = 100 - profitWidth;
  return (
    <button
      type="button"
      className={styles.candidateRow}
      data-selected={selected}
      data-tone={status.tone}
      onClick={() => onSelect(candidate)}
    >
      <span className={styles.candidateTopline}>
        <strong>{selected ? 'Selected' : VERTICAL_LABELS[candidate.kind]}</strong>
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
        </span>
      </span>
      <span className={styles.candidateBalance}>
        <i className={styles.candidateLoss} style={{ width: `${lossWidth}%` }} />
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

function humanizeRejection(reason: string): string {
  const labels: Record<string, string> = {
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
  };
  return labels[reason] ?? reason;
}
