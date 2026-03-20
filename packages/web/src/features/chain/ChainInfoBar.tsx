import type { Comparison } from "@shared/common";

import styles from "./ChainInfoBar.module.css";

interface ChainInfoBarProps {
  comparison: Comparison;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function dte(expiry: string): string {
  const now = Date.now();
  const exp = new Date(expiry + "T08:00:00Z").getTime();
  const diff = exp - now;
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${mins}m`;
}

export default function ChainInfoBar({ comparison }: ChainInfoBarProps) {
  const strikeCount = comparison.rows.length;

  return (
    <div className={styles.bar}>
      <span className={styles.date}>{formatDate(comparison.expiry)}</span>
      <span className={styles.sep}>—</span>
      <span className={styles.tte}>{dte(comparison.expiry)}</span>
      <span className={styles.sep}>—</span>
      <span className={styles.strikes}>{strikeCount} strikes</span>
    </div>
  );
}
