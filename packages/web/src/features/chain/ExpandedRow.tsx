import { useMemo } from 'react';
import type { EnrichedSide, VenueQuote, VenueId } from '@shared/enriched';

import { VENUES } from '@lib/venue-meta';
import { IvChip, SpreadPill, ForwardDeltaPill } from '@components/ui';
import { fmtUsd, fmtDelta, fmtNum, fmtIv } from '@lib/format';
import { computeImpliedForward } from './forward-analysis';
import styles from './ExpandedRow.module.css';

interface ForwardCell {
  fImplied: number | null;
  delta: number | null;
}

interface ExpandedRowProps {
  strike: number;
  callSide: EnrichedSide;
  putSide: EnrichedSide;
  myIv: number | null;
  activeVenues: string[];
  atmStrike: number | null;
  atmConsensusForward: number | null;
}

interface VenueRowProps {
  venueId: string;
  quote: VenueQuote;
  myIv: number | null;
  type: 'call' | 'put';
  strike: number;
  forwardCell: ForwardCell | undefined;
  atmStrike: number | null;
}

function VenueRow({ venueId, quote, myIv, type, strike, forwardCell, atmStrike }: VenueRowProps) {
  const meta = VENUES[venueId];
  const mid = quote.mid;
  const breakeven = mid != null ? (type === 'call' ? strike + mid : strike - mid) : null;
  const edge = myIv != null && quote.markIv != null ? myIv - quote.markIv : null;

  return (
    <tr className={styles.venueRow}>
      <td className={styles.tdVenue}>
        <div className={styles.venueCell}>
          {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
          <span className={styles.venueLabel}>{meta?.shortLabel ?? venueId}</span>
        </div>
      </td>

      <td className={styles.tdNum} data-accent="true">
        {fmtUsd(forwardCell?.fImplied ?? null)}
      </td>

      <td className={styles.tdNum}>{fmtUsd(quote.bid)}</td>
      <td className={styles.tdNum}>{fmtUsd(quote.ask)}</td>
      <td className={styles.tdNum} data-accent="true">
        {fmtUsd(quote.mid)}
      </td>
      <td className={styles.tdNum}>{fmtIv(quote.bidIv)}</td>
      <td className={styles.tdChip}>
        <IvChip iv={quote.markIv} size="sm" />
      </td>

      <td className={styles.tdNum}>{fmtIv(quote.askIv)}</td>
      <td className={styles.tdChip}>
        <SpreadPill spreadPct={quote.spreadPct} />
      </td>

      <td className={styles.tdNum}>{fmtDelta(quote.delta)}</td>
      <td
        className={styles.tdNum}
        data-negative={quote.theta != null && quote.theta < 0 ? 'true' : undefined}
      >
        {quote.theta != null ? fmtUsd(quote.theta) : '–'}
      </td>

      <td className={styles.tdNum}>
        {quote.openInterest != null ? fmtNum(quote.openInterest, 0) : '–'}
      </td>
      <td className={styles.tdNum}>{fmtUsd(breakeven)}</td>
      <td className={styles.tdNum}>{fmtUsd(quote.totalCost)}</td>

      <td className={styles.tdChip}>
        <ForwardDeltaPill delta={forwardCell?.delta ?? null} atmStrike={atmStrike} />
      </td>

      <td
        className={styles.tdNum}
        data-edge={edge != null ? (edge > 0 ? 'positive' : 'negative') : undefined}
      >
        {edge != null ? `${edge > 0 ? '+' : ''}${(edge * 100).toFixed(1)}%` : '–'}
      </td>
    </tr>
  );
}

interface SideTableProps {
  side: EnrichedSide;
  type: 'call' | 'put';
  strike: number;
  myIv: number | null;
  forwardsByVenue: Map<VenueId, ForwardCell>;
  atmStrike: number | null;
}

function SideTable({ side, type, strike, myIv, forwardsByVenue, atmStrike }: SideTableProps) {
  const entries = Object.entries(side.venues) as [VenueId, VenueQuote][];

  if (entries.length === 0) {
    return <div className={styles.noQuotes}>No quotes</div>;
  }

  return (
    <table className={styles.venueTable}>
      <thead>
        <tr className={styles.thead}>
          <th className={styles.thVenue}>VENUE</th>
          <th className={styles.th}>F_IMPLIED</th>
          <th className={styles.th}>BID</th>
          <th className={styles.th}>ASK</th>
          <th className={styles.th}>MID</th>
          <th className={styles.th}>IV BID</th>
          <th className={styles.th}>IV MARK</th>
          <th className={styles.th}>IV ASK</th>
          <th className={styles.th}>SPREAD</th>
          <th
            className={styles.th}
            title={
              'Δ DELTA — price sensitivity of this option to the underlying.\n\n' +
              '• Magnitude: option moves ~Δ dollars for each $1 move in spot. 0.50 Δ → option moves $0.50 per $1 move.\n' +
              '• Sign: calls positive, puts negative. Long calls / short puts = long delta; long puts / short calls = short delta.\n' +
              '• Proxy for moneyness: |Δ| ≈ probability of finishing in-the-money. 0.25 Δ → ~25% ITM odds.'
            }
          >
            Δ
          </th>
          <th
            className={styles.th}
            title={
              'Θ THETA — daily time decay, in USD.\n\n' +
              '• What it costs: if spot and vol do not move, the option loses this many dollars per day.\n' +
              '• Sign: long options pay theta (negative for you); short options collect theta (positive for you).\n' +
              '• Accelerates near expiry: ATM theta is small far out, steep into the last week.'
            }
          >
            THETA
          </th>
          <th className={styles.th}>OI</th>
          <th className={styles.th}>BREAK</th>
          <th className={styles.th}>COST</th>
          <th
            className={styles.th}
            title={
              'Δ VS CONSENSUS — how far this venue’s implied forward is from the cross-venue median.\n\n' +
              '• Near zero (green): clean forward. Any price difference here reflects real MM skew — potentially tradeable edge.\n' +
              '• Moderate (amber): some forward drift. Interpret price differences with caution.\n' +
              '• Large (red): forward drift dominates. Cheap/expensive prices on this venue are mostly just forward, not edge.'
            }
          >
            Δ CONS
          </th>
          <th
            className={styles.th}
            title={
              'EDGE — the gap between your IV view (“MY IV” input above the chain) and this venue’s mark IV.\n\n' +
              '• Positive (green): the venue is pricing vol lower than you think — a buyer’s edge (you’d buy premium here).\n' +
              '• Negative (red): the venue is pricing vol higher than you think — a seller’s edge (you’d sell premium here).\n' +
              '• Blank: enter a value in MY IV to see your edge against each venue.'
            }
          >
            EDGE
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([venueId, quote]) => (
          <VenueRow
            key={venueId}
            venueId={venueId}
            quote={quote}
            myIv={myIv}
            type={type}
            strike={strike}
            forwardCell={forwardsByVenue.get(venueId)}
            atmStrike={atmStrike}
          />
        ))}
      </tbody>
    </table>
  );
}

export default function ExpandedRow({
  strike,
  callSide,
  putSide,
  myIv,
  activeVenues,
  atmStrike,
  atmConsensusForward,
}: ExpandedRowProps) {
  const forwardsByVenue = useMemo<Map<VenueId, ForwardCell>>(() => {
    const map = new Map<VenueId, ForwardCell>();
    const ids = new Set<VenueId>([
      ...(Object.keys(callSide.venues) as VenueId[]),
      ...(Object.keys(putSide.venues) as VenueId[]),
    ]);
    for (const v of ids) {
      if (!activeVenues.includes(v)) continue;
      const fImplied = computeImpliedForward(
        strike,
        callSide.venues[v]?.mid ?? null,
        putSide.venues[v]?.mid ?? null,
      );
      const delta =
        fImplied != null && atmConsensusForward != null ? fImplied - atmConsensusForward : null;
      map.set(v, { fImplied, delta });
    }
    return map;
  }, [callSide, putSide, strike, activeVenues, atmConsensusForward]);

  return (
    <div className={styles.expanded}>
      {atmConsensusForward != null && atmStrike != null && (
        <div className={styles.consensusLine}>
          CONSENSUS F @ ATM {atmStrike.toLocaleString()}: {fmtUsd(atmConsensusForward)}
        </div>
      )}

      <div className={styles.side} data-type="call">
        <div className={styles.sideHeader}>
          <span className={styles.sideLabel}>CALLS</span>
          <span className={styles.sideStrike}>{strike.toLocaleString()}</span>
        </div>
        <SideTable
          side={callSide}
          type="call"
          strike={strike}
          myIv={myIv}
          forwardsByVenue={forwardsByVenue}
          atmStrike={atmStrike}
        />
      </div>

      <div className={styles.divider} />

      <div className={styles.side} data-type="put">
        <div className={styles.sideHeader}>
          <span className={styles.sideLabel}>PUTS</span>
        </div>
        <SideTable
          side={putSide}
          type="put"
          strike={strike}
          myIv={myIv}
          forwardsByVenue={forwardsByVenue}
          atmStrike={atmStrike}
        />
      </div>
    </div>
  );
}
