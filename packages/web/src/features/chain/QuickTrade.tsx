import type { EnrichedSide } from "@shared/enriched";
import { VENUES } from "@lib/venue-meta";
import { fmtUsd, fmtIv } from "@lib/format";
import { useStrategyStore } from "@features/architect/strategy-store";
import { useAppStore } from "@stores/app-store";
import styles from "./QuickTrade.module.css";

interface QuickTradeProps {
  strike:    number;
  type:      "call" | "put";
  direction: "buy" | "sell";
  side:      EnrichedSide;
  onClose:   () => void;
}

export default function QuickTrade({ strike, type, direction, side, onClose }: QuickTradeProps) {
  const addLeg = useStrategyStore((s) => s.addLeg);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const expiry = useAppStore((s) => s.expiry);
  const activeVenues = useAppStore((s) => s.activeVenues);

  const venues = Object.entries(side.venues)
    .filter(([v]) => activeVenues.includes(v))
    .map(([venueId, q]) => {
      if (!q) return null;
      const price = direction === "buy" ? q.ask : q.bid;
      return { venueId, price, iv: q.markIv, delta: q.delta, gamma: q.gamma, theta: q.theta, vega: q.vega };
    })
    .filter(Boolean)
    .filter((v) => v!.price != null && v!.price > 0)
    .sort((a, b) => {
      if (direction === "buy") return (a!.price ?? Infinity) - (b!.price ?? Infinity);
      return (b!.price ?? 0) - (a!.price ?? 0);
    }) as Array<{ venueId: string; price: number; iv: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null }>;

  function handleAddToArchitect(venueId: string, price: number, q: typeof venues[0]) {
    addLeg({
      type,
      direction,
      strike,
      expiry,
      quantity: 1,
      entryPrice: price,
      venue: venueId,
      delta: q?.delta ?? null,
      gamma: q?.gamma ?? null,
      theta: q?.theta ?? null,
      vega: q?.vega ?? null,
      iv: q?.iv ?? null,
    });
    setActiveTab("architect");
    onClose();
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.direction} data-direction={direction}>
            {direction === "buy" ? "BUY" : "SELL"}
          </span>
          <span className={styles.strike}>{strike.toLocaleString()}</span>
          <span className={styles.type} data-type={type}>{type === "call" ? "CALL" : "PUT"}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div className={styles.venueList}>
        {venues.map((v, i) => {
          const meta = VENUES[v.venueId];
          const isBest = i === 0;
          return (
            <div key={v.venueId} className={styles.venueRow} data-best={isBest || undefined}>
              <div className={styles.venueInfo}>
                {meta?.logo && <img src={meta.logo} className={styles.venueLogo} alt="" />}
                <span className={styles.venueName}>{meta?.label ?? v.venueId}</span>
                {isBest && <span className={styles.bestTag}>BEST</span>}
              </div>
              <div className={styles.venuePrice}>{fmtUsd(v.price)}</div>
              <div className={styles.venueIv}>{v.iv != null ? fmtIv(v.iv) : "–"}</div>
              <button
                className={styles.addBtn}
                onClick={() => handleAddToArchitect(v.venueId, v.price, v)}
              >
                + Architect
              </button>
            </div>
          );
        })}
        {venues.length === 0 && (
          <div className={styles.empty}>No quotes available</div>
        )}
      </div>
    </div>
  );
}
