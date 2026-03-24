import type { Leg } from "./payoff";
import type { EnrichedChainResponse } from "@shared/enriched";
import type { VenueId } from "@oggregator/protocol";
import { VENUES } from "@lib/venue-meta";
import { fmtUsd, fmtIv } from "@lib/format";
import styles from "./VenueSidebar.module.css";

interface LegVenueData {
  legId: string;
  direction: "buy" | "sell";
  strike: number;
  type: "call" | "put";
  price: number | null;
  spreadPct: number | null;
  iv: number | null;
  size: number | null;
  spreadCost: number | null;
}

interface VenueCost {
  venue:     string;
  totalCost: number;
  available: boolean;
  perLeg:    LegVenueData[];
}

interface VenueComparisonProps {
  legs:         Leg[];
  chain:        EnrichedChainResponse | null;
  activeVenues: string[];
}

export default function VenueComparison({ legs, chain, activeVenues }: VenueComparisonProps) {
  if (!chain || legs.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Venues</span>
        </div>
        <div className={styles.empty}>Add legs to compare execution across venues</div>
      </div>
    );
  }

  const venueCosts: VenueCost[] = activeVenues.map((venueId) => {
    let totalCost = 0;
    let allAvailable = true;
    const perLeg: LegVenueData[] = [];

    for (const leg of legs) {
      const strike = chain.strikes.find((s) => s.strike === leg.strike);
      const side = leg.type === "call" ? strike?.call : strike?.put;
      const q = side?.venues[venueId as VenueId];

      const price = leg.direction === "buy" ? q?.ask : q?.bid;
      const oppositePrice = leg.direction === "buy" ? q?.bid : q?.ask;
      const spreadCost = price != null && oppositePrice != null ? Math.abs(price - oppositePrice) / 2 : null;
      const bidSize = leg.direction === "buy" ? q?.askSize : q?.bidSize;

      if (price == null || price <= 0) {
        allAvailable = false;
        perLeg.push({ legId: leg.id, direction: leg.direction, strike: leg.strike, type: leg.type, price: null, spreadPct: null, iv: null, size: null, spreadCost: null });
      } else {
        const legCost = leg.direction === "buy" ? -price * leg.quantity : price * leg.quantity;
        totalCost += legCost;
        perLeg.push({ legId: leg.id, direction: leg.direction, strike: leg.strike, type: leg.type, price, spreadPct: q?.spreadPct ?? null, iv: q?.markIv ?? null, size: bidSize ?? null, spreadCost });
      }
    }

    return { venue: venueId, totalCost, available: allAvailable, perLeg };
  });

  const validCosts = venueCosts.filter((v) => v.available);
  const bestVenue = validCosts.length > 0
    ? validCosts.reduce((best, v) => v.totalCost > best.totalCost ? v : best)
    : null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Venue Execution</span>
      </div>

      <div className={styles.venueList}>
        {venueCosts.map((vc) => {
          const meta = VENUES[vc.venue];
          const isBest = bestVenue?.venue === vc.venue;
          return (
            <div key={vc.venue} className={styles.venueCard} data-best={isBest || undefined} data-unavailable={!vc.available || undefined}>
              <div className={styles.venueCardHeader}>
                {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                <span className={styles.venueName}>{meta?.label ?? vc.venue}</span>
                {isBest && <span className={styles.bestTag}>BEST</span>}
                <span className={styles.venuePrice} data-positive={vc.totalCost > 0}>
                  {vc.available ? `${vc.totalCost > 0 ? "+" : ""}${fmtUsd(vc.totalCost)}` : "N/A"}
                </span>
              </div>

              {vc.available && (
                <div className={styles.venueDetails}>
                  {vc.perLeg.map((pl) => {
                    if (pl.price == null) return null;
                    return (
                      <div key={pl.legId} className={styles.detailRow}>
                        <span className={styles.detailDir} data-direction={pl.direction}>
                          {pl.direction === "buy" ? "B" : "S"}
                        </span>
                        <span className={styles.detailStrike}>{pl.strike.toLocaleString()}</span>
                        <span className={styles.detailType} data-type={pl.type}>
                          {pl.type === "call" ? "C" : "P"}
                        </span>
                        <span className={styles.detailPrice}>{fmtUsd(pl.price)}</span>
                        {pl.spreadPct != null && <span className={styles.detailSpread}>{pl.spreadPct.toFixed(1)}%</span>}
                        {pl.iv != null && <span className={styles.detailIv}>{fmtIv(pl.iv)}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {vc.available && (
                <div className={styles.venueLabel}>
                  {vc.totalCost > 0 ? "net credit" : "net debit"}
                  {isBest && validCosts.length > 1 && (
                    <span className={styles.savings}>
                      saves {fmtUsd(Math.abs(vc.totalCost - validCosts[validCosts.length - 1]!.totalCost))}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
