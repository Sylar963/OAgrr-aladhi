import { VenueDot } from '@components/ui';
import type {
  AlphaLongStraddleCandidate,
  AlphaLongStraddleScannerResponse,
  AlphaLongStraddleVerdict,
} from '@oggregator/protocol';
import { fmtStrikeShort, fmtUsd, formatExpiry } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';

import { alphaMessages, type AlphaKey } from './i18n';
import { LONG_STRADDLE_STATUS, longStraddleMessages } from './LongStraddleDecisionCard';
import { OpportunitySection } from './OpportunityCard';
import styles from './StraddleScannerPanel.module.css';
import cards from './VenueOpportunities.module.css';

const ROWS_PER_VENUE = 3;
const messages = defineMessages(
  {
    subtitle: 'Both legs buy at the asks on one venue · figures per 1 underlying',
    note: 'Green means “inspect,” not “buy.” Ranking uses asks after fees, the matched-horizon forecast, the vol cone, and model edge per dollar of debit.',
    vsFcst: 'vs fcst',
    debit: 'debit {value}',
  },
  {
    subtitle: 'Ambas patas compran en los asks de un exchange · cifras por 1 unidad del subyacente',
    note: 'Verde significa “revisar”, no “comprar”. El ranking usa asks después de comisiones, el pronóstico al mismo horizonte, el cono de vol y el edge del modelo por dólar de débito.',
    vsFcst: 'vs pron.',
    debit: 'débito {value}',
  },
);

const CARD_STATUS: Record<AlphaLongStraddleVerdict, { label: AlphaKey; tone: string }> = {
  'buy-candidate': { label: 'cardCheck', tone: 'review' },
  watch: { label: 'cardWatch', tone: 'neutral' },
  expensive: { label: 'cardExpensive', tone: 'danger' },
  'no-forecast': { label: 'cardNoModel', tone: 'neutral' },
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
        const selected = candidates.find((candidate) => longStraddleKey(candidate) === selectedKey);
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
  const t = useT(messages);
  const ta = useT(alphaMessages);
  const tl = useT(longStraddleMessages);
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
      title={tl(LONG_STRADDLE_STATUS[candidate.verdict].message)}
      onClick={onClick}
    >
      <span className={cards.candidateTopline}>
        <strong>
          {formatExpiry(candidate.expiry)} · {candidate.dte.toFixed(0)}D
        </strong>
        <span data-tone={status.tone}>{ta(status.label)}</span>
      </span>
      <span className={`${cards.strikeRoute} ${styles.longRoute}`}>
        <span>
          <i>B</i>C {fmtStrikeShort(candidate.strike)}
        </span>
        <b />
        <span>
          <i>B</i>P {fmtStrikeShort(candidate.strike)}
        </span>
      </span>
      <span className={styles.rowVol}>
        IV {(candidate.buyIv * 100).toFixed(1)} {t('vsFcst')}{' '}
        {candidate.forecastVol == null ? '—' : (candidate.forecastVol * 100).toFixed(1)} · {ta('cone')}{' '}
        {candidate.conePercentile == null ? '—' : `p${candidate.conePercentile.toFixed(0)}`}
      </span>
      <span className={cards.candidateBalance}>
        <i className={cards.candidateLoss} style={{ width: `${100 - fairWidth}%` }} />
        <i className={cards.candidateProfit} style={{ width: `${fairWidth}%` }} />
      </span>
      <span className={cards.candidateNumbers}>
        <span>{t('debit', { value: fmtUsd(candidate.netDebit) })}</span>
        <span>{ta('edge', { value: fmtUsd(candidate.modelEdgeUsd) })}</span>
        <span>θ −{fmtUsd(candidate.thetaUsdPerDay)}/d</span>
      </span>
      <span className={cards.loadLabel}>{ta('loadStraddle')}</span>
    </button>
  );
}

