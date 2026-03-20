import type { CSSProperties } from "react";
import { VENUE_LIST, VENUES } from "@lib/venue-meta";
import { venueColor } from "@lib/colors";
import { fmtUsdCompact } from "@lib/format";
import styles from "./VenueSidebar.module.css";

interface VenueSidebarProps {
  activeVenues: string[];
  onToggle:     (venueId: string) => void;
  // Optional OI data per venue (from chain response)
  venueOi?:    Record<string, number>;
}

export default function VenueSidebar({ activeVenues, onToggle, venueOi }: VenueSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>Venues</div>
      <div className={styles.list}>
        {VENUE_LIST.map((venue) => {
          const active = activeVenues.includes(venue.id);
          const oi     = venueOi?.[venue.id];
          const color  = venueColor(venue.id);
          const meta   = VENUES[venue.id];
          return (
            <label
              key={venue.id}
              className={styles.item}
              data-active={active}
              style={{ "--venue-color": color } as CSSProperties}
            >
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={active}
                onChange={() => onToggle(venue.id)}
              />
              <img src={venue.logo} alt="" className={styles.logo} />
              <span className={styles.name}>{venue.label}</span>
              {oi != null && (
                <span className={styles.oi}>{fmtUsdCompact(oi)}</span>
              )}
              {active && meta && (
                <span
                  className={styles.tag}
                  style={{ "--venue-color": color } as CSSProperties}
                >
                  {meta.shortLabel}
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.settleNote}>
          <span className={styles.settleLabel}>Settlement</span>
          <div className={styles.settleItems}>
            <span>Deribit · USDC</span>
            <span>OKX · USDC</span>
            <span>Binance · USDT</span>
            <span>Bybit · USDC</span>
            <span>Derive · USDC</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
