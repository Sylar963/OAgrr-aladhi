import { IvChip, SpreadPill } from '@components/ui';
import { fmtDelta, fmtUsd } from '@lib/format';
import { VENUES } from '@lib/venue-meta';
import type { EnrichedSide, EnrichedStrike } from '@shared/enriched';
import { FlashingPrice } from './FlashingPrice';
import styles from './MobileStrikeCard.module.css';
import { bestBidAsk, crossVenueSpreadPct } from './quote-selection';

interface MobileStrikeCardProps {
  strike: EnrichedStrike;
  isAtm: boolean;
  indexPrice: number | null;
  activeVenues: string[];
  isExpanded: boolean;
  onToggle: () => void;
  freshnessNow: number;
  underlying?: string;
  expiry?: string;
  // When provided, an expanded card shows per-side chart buttons that route to a
  // venue-owned chart surface (TradFi). Absent for crypto → no buttons, unchanged.
  chartOverride?: (target: {
    underlying: string;
    expiry: string;
    strike: number;
    type: 'call' | 'put';
  }) => void;
}

interface SideSummaryProps {
  side: EnrichedSide;
  type: 'call' | 'put';
  itm: boolean;
  venues: string[];
  freshnessNow: number;
}

function SideSummary({ side, type, itm, venues, freshnessNow }: SideSummaryProps) {
  const bestQ = side.bestVenue != null ? (side.venues[side.bestVenue] ?? null) : null;
  const bba = bestBidAsk(side, new Set(venues), freshnessNow);

  return (
    <div className={styles.side} data-type={type} data-itm={itm}>
      <div className={styles.sideHeader}>
        <span className={styles.sideLabel}>{type === 'call' ? 'C' : 'P'}</span>
        <div className={styles.sideVenues}>
          {venues.map((venueId) => {
            const meta = VENUES[venueId];
            return meta?.logo ? (
              <img
                key={venueId}
                src={meta.logo}
                alt={meta.shortLabel ?? venueId}
                className={styles.venueLogo}
              />
            ) : null;
          })}
        </div>
      </div>
      <div className={styles.sideRow}>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>BID</span>
          <FlashingPrice text={fmtUsd(bba.bid)} className={styles.metricBid} />
        </div>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>SPR</span>
          <SpreadPill spreadPct={crossVenueSpreadPct(bba)} />
        </div>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>ASK</span>
          <FlashingPrice text={fmtUsd(bba.ask)} className={styles.metricAsk} />
        </div>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>IV</span>
          <IvChip iv={side.bestIv} size="sm" />
        </div>
        <div className={styles.sideMetric}>
          <span className={styles.metricLabel}>Δ</span>
          <span className={styles.metricDelta}>{fmtDelta(bestQ?.delta ?? null)}</span>
        </div>
      </div>
    </div>
  );
}

function ExpandedVenueDetail({
  side,
  type,
  venues,
}: {
  side: EnrichedSide;
  type: string;
  venues: string[];
}) {
  const entries = Object.entries(side.venues).filter(([v]) => venues.includes(v));

  return (
    <div className={styles.venueDetail}>
      <div className={styles.venueDetailLabel}>{type === 'call' ? 'CALLS' : 'PUTS'}</div>
      {entries.map(([venueId, q]) => {
        const meta = VENUES[venueId];
        return (
          <div key={venueId} className={styles.venueDetailRow}>
            <div className={styles.venueDetailName}>
              {meta?.logo && <img src={meta.logo} className={styles.venueDetailLogo} alt="" />}
              <span>{meta?.shortLabel ?? venueId}</span>
            </div>
            <div className={styles.venueDetailGrid}>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Bid</span>
                <span>{fmtUsd(q?.bid ?? null)}</span>
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Ask</span>
                <span>{fmtUsd(q?.ask ?? null)}</span>
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Mid</span>
                <span className={styles.vdAccent}>{fmtUsd(q?.mid ?? null)}</span>
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>IV</span>
                <IvChip iv={q?.markIv ?? null} size="sm" />
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Spread</span>
                <SpreadPill spreadPct={q?.spreadPct ?? null} />
              </span>
              <span className={styles.vdCell}>
                <span className={styles.vdLabel}>Δ</span>
                <span>{fmtDelta(q?.delta ?? null)}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MobileStrikeCard({
  strike,
  isAtm,
  indexPrice,
  activeVenues,
  isExpanded,
  onToggle,
  freshnessNow,
  underlying,
  expiry,
  chartOverride,
}: MobileStrikeCardProps) {
  const callItm = indexPrice != null && strike.strike < indexPrice;
  const putItm = indexPrice != null && strike.strike > indexPrice;
  const venues = Object.keys(strike.call.venues).filter((v) => activeVenues.includes(v));
  const distLabel =
    indexPrice != null && indexPrice !== 0
      ? `${(strike.strike - indexPrice) / indexPrice >= 0 ? '+' : ''}${(((strike.strike - indexPrice) / indexPrice) * 100).toFixed(1)}%`
      : null;

  return (
    <div className={styles.card} data-atm={isAtm} data-expanded={isExpanded}>
      <button className={styles.cardHeader} onClick={onToggle}>
        <div className={styles.strikeInfo}>
          <span className={styles.strikeNum}>{strike.strike.toLocaleString()}</span>
          {distLabel && <span className={styles.strikeDist}>{distLabel}</span>}
        </div>
        <span className={styles.chevron} data-expanded={isExpanded}>
          ›
        </span>
      </button>

      <div className={styles.sides}>
        <SideSummary
          side={strike.call}
          type="call"
          itm={callItm}
          venues={venues}
          freshnessNow={freshnessNow}
        />
        <SideSummary
          side={strike.put}
          type="put"
          itm={putItm}
          venues={venues}
          freshnessNow={freshnessNow}
        />
      </div>

      {isExpanded && (
        <div className={styles.expandedBody}>
          {chartOverride && underlying && expiry && (
            <div className={styles.chartActions}>
              <button
                type="button"
                className={styles.chartBtn}
                onClick={() =>
                  chartOverride({ underlying, expiry, strike: strike.strike, type: 'call' })
                }
              >
                Call chart
              </button>
              <button
                type="button"
                className={styles.chartBtn}
                onClick={() =>
                  chartOverride({ underlying, expiry, strike: strike.strike, type: 'put' })
                }
              >
                Put chart
              </button>
            </div>
          )}
          <ExpandedVenueDetail side={strike.call} type="call" venues={activeVenues} />
          <ExpandedVenueDetail side={strike.put} type="put" venues={activeVenues} />
        </div>
      )}
    </div>
  );
}
