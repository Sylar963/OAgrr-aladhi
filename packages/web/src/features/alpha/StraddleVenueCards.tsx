import { VenueDot } from '@components/ui';
import type {
  AlphaStraddleCandidate,
  AlphaStraddleScannerResponse,
  AlphaStraddleVerdict,
} from '@oggregator/protocol';
import { fmtStrikeShort, fmtUsd, formatExpiry } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';

import { alphaMessages, type AlphaKey } from './i18n';
import { OpportunitySection } from './OpportunityCard';
import { STRADDLE_STATUS, straddleMessages } from './StraddleDecisionCard';
import styles from './StraddleScannerPanel.module.css';
import cards from './VenueOpportunities.module.css';

const ROWS_PER_VENUE = 3;
const messages = defineMessages(
  {
    subtitle: 'Both legs sell at the bids on one venue · figures per 1 underlying',
    note: 'Green means “inspect,” not “sell.” Ranking uses bids after fees, the matched-horizon forecast, the vol cone, and model edge per unit of stress loss.',
    stress: 'stress −{value}',
    credit: 'credit {value}',
  },
  {
    subtitle: 'Ambas patas venden en los bids de un exchange · cifras por 1 unidad del subyacente',
    note: 'Verde significa “revisar”, no “vender”. El ranking usa bids después de comisiones, el pronóstico al mismo horizonte, el cono de vol y el edge del modelo por unidad de pérdida de estrés.',
    stress: 'estrés −{value}',
    credit: 'crédito {value}',
  },
);

const CARD_STATUS: Record<AlphaStraddleVerdict, { label: AlphaKey; tone: string }> = {
  'sell-candidate': { label: 'cardCheck', tone: 'review' },
  watch: { label: 'cardWatch', tone: 'neutral' },
  cheap: { label: 'cardCheap', tone: 'danger' },
  'no-forecast': { label: 'cardNoModel', tone: 'neutral' },
};

export function straddleKey(candidate: AlphaStraddleCandidate): string {
  return `${candidate.venue}:${candidate.expiry}:${candidate.strike}`;
}

export default function StraddleVenueCards({
  data,
  selectedKey,
  onSelect,
}: {
  data: AlphaStraddleScannerResponse;
  selectedKey: string | null;
  onSelect: (candidate: AlphaStraddleCandidate) => void;
}) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  return (
    <OpportunitySection
      title={ta('straddlesByVenue')}
      subtitle={t('subtitle')}
      count={data.candidates.length}
      countLabel={ta('liveStraddles')}
      emptyHint={ta('noExpiriesWindow')}
      note={t('note')}
      isEmpty={data.venueStatus.length === 0}
    >
      {data.venueStatus.map((status) => {
        const candidates = data.candidates.filter((candidate) => candidate.venue === status.venue);
        const selected = candidates.find((candidate) => straddleKey(candidate) === selectedKey);
        const rows = [
          ...(selected ? [selected] : []),
          ...candidates.filter((candidate) => candidate !== selected),
        ].slice(0, ROWS_PER_VENUE);
        const best = candidates[0];
        const state = best
          ? { label: ta(CARD_STATUS[best.verdict].label), tone: CARD_STATUS[best.verdict].tone }
          : { label: ta('noStraddle'), tone: 'empty' };
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
              <span>{ta('expiriesInWindow')}</span>
              <strong>{ta('pricedOf', { n: candidates.length, total: status.eligibleExpiries })}</strong>
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
                  <strong>{ta('noAtmStraddle')}</strong>
                  <small>{status.error ?? ta('noQuotesPassed')}</small>
                </div>
              </div>
            ) : (
              <div className={cards.candidateStack}>
                {rows.map((candidate) => (
                  <StraddleRow
                    key={straddleKey(candidate)}
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

function StraddleRow({
  candidate,
  selected,
  onClick,
}: {
  candidate: AlphaStraddleCandidate;
  selected: boolean;
  onClick: () => void;
}) {
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const ts = useT(straddleMessages);
  const status = CARD_STATUS[candidate.verdict];
  const total = candidate.stressLossUsd + candidate.netCredit;
  const creditWidth = total > 0 ? (candidate.netCredit / total) * 100 : 50;
  return (
    <button
      type="button"
      className={cards.candidateRow}
      data-selected={selected}
      data-tone={status.tone}
      title={ts(STRADDLE_STATUS[candidate.verdict].message)}
      onClick={onClick}
    >
      <span className={cards.candidateTopline}>
        <strong>
          {formatExpiry(candidate.expiry)} · {candidate.dte.toFixed(0)}D
        </strong>
        <span data-tone={status.tone}>{ta(status.label)}</span>
      </span>
      <span className={`${cards.strikeRoute} ${styles.straddleRoute}`}>
        <span>
          <i>S</i>C {fmtStrikeShort(candidate.strike)}
        </span>
        <b />
        <span>
          <i>S</i>P {fmtStrikeShort(candidate.strike)}
        </span>
      </span>
      <span className={styles.rowVol}>
        IV {(candidate.sellIv * 100).toFixed(1)} {ta('vs')}{' '}
        {candidate.hurdleVol == null ? '—' : (candidate.hurdleVol * 100).toFixed(1)} · {ta('cone')}{' '}
        {candidate.conePercentile == null ? '—' : `p${candidate.conePercentile.toFixed(0)}`}
      </span>
      <span className={cards.candidateBalance}>
        <i className={cards.candidateLoss} style={{ width: `${100 - creditWidth}%` }} />
        <i className={cards.candidateProfit} style={{ width: `${creditWidth}%` }} />
      </span>
      <span className={cards.candidateNumbers}>
        <span>{t('stress', { value: fmtUsd(candidate.stressLossUsd) })}</span>
        <span>{ta('edge', { value: fmtUsd(candidate.modelEdgeUsd) })}</span>
        <span>{t('credit', { value: fmtUsd(candidate.netCredit) })}</span>
      </span>
      <span className={cards.loadLabel}>{ta('loadStraddle')}</span>
    </button>
  );
}

