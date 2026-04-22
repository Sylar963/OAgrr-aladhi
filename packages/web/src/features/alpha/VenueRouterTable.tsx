import { VenueDot } from '@components/ui';
import { fmtIv, fmtUsd, fmtCompact } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import type { LegRoute, VenueLegCandidate } from '@lib/analytics/verticalSpread';

import styles from './VenueRouterTable.module.css';

interface Props {
  shortLeg: LegRoute | null;
  longLeg: LegRoute | null;
  shortStrike: number | null;
  longStrike: number | null;
  executableNetCredit: number | null;
}

export default function VenueRouterTable({
  shortLeg,
  longLeg,
  shortStrike,
  longStrike,
  executableNetCredit,
}: Props) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Cross-venue routing</span>
        <span className={styles.subtitle}>Best execution per leg</span>
      </div>

      <LegTable
        legKind="short"
        strike={shortStrike}
        route={shortLeg}
        heading="Short leg · SELL"
      />
      <LegTable
        legKind="long"
        strike={longStrike}
        route={longLeg}
        heading="Long leg · BUY"
      />

      <div className={styles.sum}>
        <span className={styles.sumLabel}>Executable net credit (after fees)</span>
        <span className={styles.sumValue} data-kind="credit">
          {fmtUsd(executableNetCredit)}
        </span>
      </div>
    </div>
  );
}

interface LegTableProps {
  legKind: 'short' | 'long';
  strike: number | null;
  route: LegRoute | null;
  heading: string;
}

function LegTable({ legKind, strike, route, heading }: LegTableProps) {
  return (
    <div className={styles.leg} data-kind={legKind}>
      <div className={styles.legHeader}>
        <span className={styles.legHeading}>{heading}</span>
        {strike != null && <span className={styles.legStrike}>@ {strike.toLocaleString()}</span>}
      </div>

      {(!route || route.candidates.length === 0) && (
        <div className={styles.empty}>No venues available at this strike.</div>
      )}

      {route && route.candidates.length > 0 && (
        <div className={styles.table}>
          <div className={styles.thead}>
            <div>Venue</div>
            <div className={styles.alignRight}>IV</div>
            <div className={styles.alignRight}>{legKind === 'short' ? 'Bid' : 'Ask'}</div>
            <div className={styles.alignRight}>Size</div>
            <div className={styles.alignRight}>Fee</div>
            <div className={styles.alignRight}>Net</div>
          </div>
          {route.candidates.map((c) => (
            <VenueRow
              key={c.venue}
              cand={c}
              isBest={route.best?.venue === c.venue}
              legKind={legKind}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VenueRow({
  cand,
  isBest,
  legKind,
}: {
  cand: VenueLegCandidate;
  isBest: boolean;
  legKind: 'short' | 'long';
}) {
  const meta = VENUES[cand.venue];
  return (
    <div className={styles.row} data-best={isBest} data-kind={legKind}>
      <div className={styles.venueCell}>
        <VenueDot venueId={cand.venue} isBest={isBest} />
        <span className={styles.venueLabel}>{meta?.label ?? cand.venue}</span>
        {cand.sourcedIv === 'inferred' && (
          <span className={styles.badge} title="IV inferred from price (venue did not publish bid/ask IV)">
            inf
          </span>
        )}
      </div>
      <div className={styles.cell}>{fmtIv(cand.iv)}</div>
      <div className={styles.cell}>{fmtUsd(cand.executablePrice)}</div>
      <div className={styles.cell}>{fmtCompact(cand.size)}</div>
      <div className={styles.cell}>{fmtUsd(cand.takerFee)}</div>
      <div className={styles.cell} data-win={isBest}>
        {fmtUsd(cand.netAfterFees)}
      </div>
    </div>
  );
}
