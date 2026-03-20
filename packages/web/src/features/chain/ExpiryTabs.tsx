import { getTokenLogo } from "@lib/token-meta";
import { useUIStore } from "@stores/ui.store";

import styles from "./ExpiryTabs.module.css";

interface ExpiryTabsProps {
  expiries: string[];
  selected: string;
  onSelect: (expiry: string) => void;
  onOpenPalette: () => void;
}

function formatExpiry(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate().toString().padStart(2, "0");
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${day} ${months[d.getUTCMonth()]!}`;
}

function dteDays(expiry: string): number {
  const now = Date.now();
  const exp = new Date(expiry + "T08:00:00Z").getTime();
  return Math.max(0, Math.ceil((exp - now) / 86_400_000));
}

export default function ExpiryTabs({ expiries, selected, onSelect, onOpenPalette }: ExpiryTabsProps) {
  const underlying = useUIStore((s) => s.underlying);
  const logo = getTokenLogo(underlying);

  return (
    <div className={styles.strip}>
      {/* Asset picker — compact, at start of row */}
      <button className={styles.assetPicker} onClick={onOpenPalette}>
        {logo && <img src={logo} className={styles.assetIcon} alt={underlying} />}
        <span className={styles.assetLabel}>{underlying}</span>
        <span className={styles.assetChevron}>▾</span>
      </button>

      <div className={styles.divider} />

      {expiries.map((e) => {
        const dte = dteDays(e);
        return (
          <button
            key={e}
            className={styles.tab}
            data-active={e === selected}
            onClick={() => onSelect(e)}
          >
            {formatExpiry(e)}
            {dte <= 3 && <span className={styles.dteBadge}>{dte}d</span>}
          </button>
        );
      })}
    </div>
  );
}
