import type { Leg } from "./payoff";
import type { EnrichedChainResponse } from "@shared/enriched";
import type { VenueId } from "@oggregator/protocol";
import { VENUES } from "@lib/venue-meta";
import { fmtUsd, fmtIv } from "@lib/format";
import styles from "./Architect.module.css";

interface VenueCost {
  venue:     string;
  totalCost: number;
  available: boolean;
  perLeg:    Array<{ legId: string; price: number | null; spread: number | null; iv: number | null }>;
}

interface VenueComparisonProps {
  legs:         Leg[];
  chain:        EnrichedChainResponse | null;
  activeVenues: string[];
}

export default function VenueComparison({ legs, chain, activeVenues }: VenueComparisonProps) {
  if (!chain || legs.length === 0) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.sidebarTitle}>Venues</div>
        <div className={styles.sidebarEmpty}>Add legs to compare execution across venues</div>
      </div>
    );
  }

  const venueCosts: VenueCost[] = activeVenues.map((venueId) => {
    let totalCost = 0;
    let allAvailable = true;
    const perLeg: VenueCost["perLeg"] = [];

    for (const leg of legs) {
      const strike = chain.strikes.find((s) => s.strike === leg.strike);
      const side = leg.type === "call" ? strike?.call : strike?.put;
      const q = side?.venues[venueId as VenueId];

      const price = leg.direction === "buy" ? q?.ask : q?.bid;
      if (price == null) {
        allAvailable = false;
        perLeg.push({ legId: leg.id, price: null, spread: null, iv: null });
      } else {
        const legCost = leg.direction === "buy" ? -price * leg.quantity : price * leg.quantity;
        totalCost += legCost;
        perLeg.push({ legId: leg.id, price, spread: q?.spreadPct ?? null, iv: q?.markIv ?? null });
      }
    }

    return { venue: venueId, totalCost, available: allAvailable, perLeg };
  });

  const validCosts = venueCosts.filter((v) => v.available);
  const bestVenue = validCosts.length > 0
    ? validCosts.reduce((best, v) => v.totalCost > best.totalCost ? v : best)
    : null;

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarTitle}>Venue Execution</div>

      {venueCosts.map((vc) => {
        const meta = VENUES[vc.venue];
        const isBest = bestVenue?.venue === vc.venue;
        return (
          <div
            key={vc.venue}
            className={styles.sidebarVenue}
            data-best={isBest || undefined}
            data-unavailable={!vc.available || undefined}
          >
            <div className={styles.sidebarVenueHeader}>
              {meta?.logo && <img src={meta.logo} className={styles.sidebarVenueLogo} alt="" />}
              <span className={styles.sidebarVenueName}>{meta?.label ?? vc.venue}</span>
              {isBest && <span className={styles.sidebarBestTag}>BEST</span>}
              <span className={styles.sidebarVenueTotal} data-positive={vc.totalCost > 0}>
                {vc.available
                  ? `${vc.totalCost > 0 ? "+" : ""}${fmtUsd(vc.totalCost)}`
                  : "N/A"
                }
              </span>
            </div>

            {vc.available && (
              <div className={styles.sidebarLegDetails}>
                {vc.perLeg.map((pl, i) => {
                  const leg = legs[i];
                  if (!leg || pl.price == null) return null;
                  return (
                    <div key={pl.legId} className={styles.sidebarLegRow}>
                      <span className={styles.sidebarLegDir} data-direction={leg.direction}>
                        {leg.direction === "buy" ? "B" : "S"}
                      </span>
                      <span className={styles.sidebarLegStrike}>{leg.strike.toLocaleString()}</span>
                      <span className={styles.sidebarLegType} data-type={leg.type}>
                        {leg.type === "call" ? "C" : "P"}
                      </span>
                      <span className={styles.sidebarLegPrice}>{fmtUsd(pl.price)}</span>
                      {pl.spread != null && (
                        <span className={styles.sidebarLegSpread}>{pl.spread.toFixed(1)}%</span>
                      )}
                      {pl.iv != null && (
                        <span className={styles.sidebarLegIv}>{fmtIv(pl.iv)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {vc.available && (
              <div className={styles.sidebarVenueLabel}>
                {vc.totalCost > 0 ? "net credit" : "net debit"}
                {isBest && bestVenue && validCosts.length > 1 && (
                  <span className={styles.sidebarSavings}>
                    saves {fmtUsd(Math.abs(vc.totalCost - validCosts[validCosts.length - 1]!.totalCost))}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
