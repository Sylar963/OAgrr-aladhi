import { VenueDot } from '@components/ui';
import type {
  AlphaLongStraddleCandidate,
  AlphaLongStraddleScannerResponse,
  AlphaLongStraddleVerdict,
} from '@oggregator/protocol';
import { fmtUsd, formatExpiry } from '@lib/format';
import { VENUES } from '@lib/venue-meta';

import { LONG_STRADDLE_STATUS } from './LongStraddleDecisionCard';
import { OpportunitySection } from './OpportunityCard';
import styles from './StraddleScannerPanel.module.css';
import cards from './VenueOpportunities.module.css';

const ROWS_PER_VENUE = 3;
const CARD_STATUS: Record<AlphaLongStraddleVerdict, { label: string; tone: string }> = {
  'buy-candidate': { label: 'CHECK', tone: 'review' },
  watch: { label: 'WATCH', tone: 'neutral' },
  expensive: { label: 'EXPENSIVE', tone: 'danger' },
  'no-forecast': { label: 'NO MODEL', tone: 'neutral' },
};

export function longStraddleKey(candidate: AlphaLongStraddleCandidate): string {
  return `${candidate.venue}:${candidate.expiry}:${candidate.strike}`;
}

export default function LongStraddleVenueCards({
  data,
  selectedKey,
  onSelect,
}: {
  data: AlphaLongStraddleScannerResponse;
  selectedKey: string | null;
  onSelect: (candidate: AlphaLongStraddleCandidate) => void;
}) {
  return (
    <OpportunitySection
      title="Straddles by venue"
      subtitle="Both legs buy at the asks on one venue · figures per 1 underlying"
      count={data.candidates.length}
      countLabel="live straddles"
      emptyHint="No venues returned expiries for this window."
      note="Green means “inspect,” not “buy.” Ranking uses asks after fees, the matched-horizon forecast, the vol cone, and model edge per dollar of debit."
      isEmpty={data.venueStatus.length === 0}
    >
      {data.venueStatus.map((status) => {
        const candidates = data.candidates.filter((candidate) => candidate.venue === status.venue);
        const selected = candidates.find((candidate) => longStraddleKey(candidate) === selectedKey);
        const rows = [
          ...(selected ? [selected] : []),
          ...candidates.filter((candidate) => candidate !== selected),
        ].slice(0, ROWS_PER_VENUE);
        const best = candidates[0];
        const state = best ? CARD_STATUS[best.verdict] : { label: 'NO STRADDLE', tone: 'empty' };
        return (
          <section className={cards.venueCard} data-tone={state.tone} key={status.venue}>
            <header className={cards.venueCardHeader}>
              <span className={cards.venueName}>
                <VenueDot venueId={status.venue} isBest={state.tone === 'review'} />
                {VENUES[status.venue]?.label ?? status.venue}
              </span>
              <span className={cards.venueState} data-tone={state.tone}>
                {state.label}
              </span>
            </header>
            <div className={cards.coverageRow}>
              <span>Expiries in window</span>
              <strong>
                {candidates.length}/{status.eligibleExpiries} priced
              </strong>
            </div>
            <div className={cards.coverageTrack}>
              <span
                style={{
                  width: `${status.eligibleExpiries === 0 ? 0 : Math.max((candidates.length / status.eligibleExpiries) * 100, candidates.length > 0 ? 3 : 0)}%`,
                }}
              />
            </div>
            {rows.length === 0 ? (
              <div className={cards.noPair}>
                <span aria-hidden="true">∅</span>
                <div>
                  <strong>No executable ATM straddle</strong>
                  <small>
                    {status.error ?? 'No quotes passed the freshness, fee, and spread checks'}
                  </small>
                </div>
              </div>
            ) : (
              <div className={cards.candidateStack}>
                {rows.map((candidate) => (
                  <LongStraddleRow
                    key={longStraddleKey(candidate)}
                    candidate={candidate}
                    selected={candidate === selected}
                    onClick={() => onSelect(candidate)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </OpportunitySection>
  );
}

function LongStraddleRow({
  candidate,
  selected,
  onClick,
}: {
  candidate: AlphaLongStraddleCandidate;
  selected: boolean;
  onClick: () => void;
}) {
  const status = CARD_STATUS[candidate.verdict];
  const fair = candidate.fairValueAtForecast ?? candidate.netDebit;
  const total = fair + candidate.netDebit;
  const fairWidth = total > 0 ? (fair / total) * 100 : 50;
  return (
    <button
      type="button"
      className={cards.candidateRow}
      data-selected={selected}
      data-tone={status.tone}
      title={LONG_STRADDLE_STATUS[candidate.verdict].message}
      onClick={onClick}
    >
      <span className={cards.candidateTopline}>
        <strong>
          {formatExpiry(candidate.expiry)} · {candidate.dte.toFixed(0)}D
        </strong>
        <span data-tone={status.tone}>{status.label}</span>
      </span>
      <span className={`${cards.strikeRoute} ${styles.longRoute}`}>
        <span>
          <i>B</i>C {fmtStrike(candidate.strike)}
        </span>
        <b />
        <span>
          <i>B</i>P {fmtStrike(candidate.strike)}
        </span>
      </span>
      <span className={styles.rowVol}>
        IV {(candidate.buyIv * 100).toFixed(1)} vs fcst{' '}
        {candidate.forecastVol == null ? '—' : (candidate.forecastVol * 100).toFixed(1)} · cone{' '}
        {candidate.conePercentile == null ? '—' : `p${candidate.conePercentile.toFixed(0)}`}
      </span>
      <span className={cards.candidateBalance}>
        <i className={cards.candidateLoss} style={{ width: `${100 - fairWidth}%` }} />
        <i className={cards.candidateProfit} style={{ width: `${fairWidth}%` }} />
      </span>
      <span className={cards.candidateNumbers}>
        <span>debit {fmtUsd(candidate.netDebit)}</span>
        <span>edge {fmtUsd(candidate.modelEdgeUsd)}</span>
        <span>θ −{fmtUsd(candidate.thetaUsdPerDay)}/d</span>
      </span>
      <span className={cards.loadLabel}>Load straddle →</span>
    </button>
  );
}

function fmtStrike(value: number): string {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`
    : value.toFixed(0);
}
