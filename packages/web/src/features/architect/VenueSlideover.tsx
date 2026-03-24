import type { Leg } from "./payoff";
import type { EnrichedChainResponse } from "@shared/enriched";
import type { VenueId } from "@oggregator/protocol";
import { VenueCard, type VenueCardDetail } from "@components/ui";
import { fmtUsd } from "@lib/format";
import { computeExecutionCost } from "@features/builder/compute-execution";
import type { VenueExecution } from "@features/builder/types";
import { detectStrategy } from "./payoff";
import styles from "./VenueSlideover.module.css";

interface VenueSlideoverProps {
  legs:         Leg[];
  chain:        EnrichedChainResponse | null;
  activeVenues: string[];
  onClose:      () => void;
}

function buildVenueExecution(
  chain: EnrichedChainResponse,
  venueId: string,
  leg: Leg,
): VenueExecution | null {
  const strike = chain.strikes.find((s) => s.strike === leg.strike);
  if (!strike) return null;
  const side = leg.type === "call" ? strike.call : strike.put;
  const q = side.venues[venueId as VenueId];
  if (!q) return null;

  // Get contract metadata from the raw chain if available
  return {
    venue: venueId,
    available: true,
    bidPrice: q.bid,
    askPrice: q.ask,
    markPrice: q.mid,
    bidSize: q.bidSize,
    askSize: q.askSize,
    iv: q.markIv,
    delta: q.delta,
    contractSize: 1, // Already USD-normalized by core
    tickSize: 0.01,
    minQty: 0.01,
    makerFee: q.estimatedFees ? q.estimatedFees.maker / (q.mid ?? 1) : 0.0003,
    takerFee: q.estimatedFees ? q.estimatedFees.taker / (q.mid ?? 1) : 0.0005,
    settleCurrency: "USD",
    inverse: false,
    underlyingPrice: chain.stats.spotIndexUsd ?? chain.stats.forwardPriceUsd ?? 0,
  };
}

export default function VenueSlideover({ legs, chain, activeVenues, onClose }: VenueSlideoverProps) {
  if (!chain || legs.length === 0) return null;

  const strategyName = detectStrategy(legs);

  const venueCosts = activeVenues.map((venueId) => {
    let totalCost = 0;
    let totalFees = 0;
    let totalSpread = 0;
    let allAvailable = true;
    const details: VenueCardDetail[] = [];

    for (const leg of legs) {
      const ve = buildVenueExecution(chain, venueId, leg);
      if (!ve) { allAvailable = false; continue; }

      const exec = computeExecutionCost(ve, leg.direction, leg.quantity);
      if (!exec) { allAvailable = false; continue; }

      const signedCost = leg.direction === "buy" ? -exec.totalCostUsd : exec.totalCostUsd;
      totalCost += signedCost;
      totalFees += exec.feeUsd;
      totalSpread += exec.spreadCostUsd;

      const q = (leg.type === "call" ? chain.strikes.find((s) => s.strike === leg.strike)?.call : chain.strikes.find((s) => s.strike === leg.strike)?.put)?.venues[venueId as VenueId];

      details.push({
        label: `${leg.strike}`,
        strike: leg.strike,
        type: leg.type,
        direction: leg.direction,
        price: exec.entryPrice,
        spreadPct: q?.spreadPct ?? null,
        iv: q?.markIv ?? null,
        size: exec.sizeAvailable,
        spreadCost: exec.spreadCostUsd > 0 ? exec.spreadCostUsd : null,
      });
    }

    return { venue: venueId, totalCost, totalFees, totalSpread, available: allAvailable, details };
  });

  const validCosts = venueCosts.filter((v) => v.available);
  const bestVenue = validCosts.length > 0
    ? validCosts.reduce((best, v) => v.totalCost > best.totalCost ? v : best)
    : null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.strategyName}>{strategyName}</span>
          <span className={styles.legCount}>{legs.length} leg{legs.length !== 1 ? "s" : ""}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div className={styles.venueList}>
        {venueCosts.map((vc) => {
          const isBest = bestVenue?.venue === vc.venue;
          const worstCost = validCosts.length > 1 ? validCosts[validCosts.length - 1]!.totalCost : vc.totalCost;
          const savingsText = isBest && validCosts.length > 1
            ? `saves ${fmtUsd(Math.abs(vc.totalCost - worstCost))}`
            : undefined;

          return (
            <VenueCard
              key={vc.venue}
              venueId={vc.venue}
              total={vc.available ? vc.totalCost : null}
              totalLabel={vc.available
                ? `${vc.totalCost > 0 ? "credit" : "debit"} · fee ${fmtUsd(vc.totalFees)} · spread ${fmtUsd(vc.totalSpread)}`
                : undefined
              }
              isBest={isBest}
              available={vc.available}
              details={vc.details}
              savings={savingsText}
            />
          );
        })}
      </div>
    </div>
  );
}
