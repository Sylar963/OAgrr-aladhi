import type { ChainStats } from "@shared/enriched";

import { fmtUsd, fmtUsdCompact, fmtIv, fmtPct, fmtNum } from "@lib/format";
import styles from "./StatStrip.module.css";

interface StatStripProps {
  stats:      ChainStats;
  underlying: string;
  dte:        number;
}

interface StatCellProps {
  label:    string;
  value:    string;
  sub?:     string;
  accent?:  boolean;
  positive?: boolean | null; // true = green, false = red, null/undefined = neutral
}

function StatCell({ label, value, sub, accent, positive }: StatCellProps) {
  return (
    <div className={styles.cell}>
      <span className={styles.label}>{label}</span>
      <span
        className={styles.value}
        data-accent={accent}
        data-positive={positive === true ? "true" : positive === false ? "false" : undefined}
      >
        {value}
      </span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </div>
  );
}

export default function StatStrip({ stats, underlying, dte }: StatStripProps) {
  const forwardSub = stats.forwardBasisPct != null
    ? fmtPct(stats.forwardBasisPct, 3)
    : undefined;

  const skewPositive = stats.skew25d != null
    ? stats.skew25d > 0
    : null;

  return (
    <div className={styles.strip}>
      <StatCell
        label={`${underlying} Spot`}
        value={fmtUsd(stats.spotIndexUsd)}
        sub={stats.forwardPriceUsd != null ? `Fwd ${fmtUsd(stats.forwardPriceUsd)}` : undefined}
      />
      <div className={styles.divider} />
      <StatCell
        label="ATM IV"
        value={fmtIv(stats.atmIv)}
        accent
      />
      <div className={styles.divider} />
      <StatCell
        label="Put/Call OI"
        value={stats.putCallOiRatio != null ? fmtNum(stats.putCallOiRatio) : "–"}
        sub={`${dte}d to expiry`}
      />
      <div className={styles.divider} />
      <StatCell
        label="25Δ Skew"
        value={stats.skew25d != null ? fmtIv(stats.skew25d) : "–"}
        sub="put − call"
        positive={skewPositive}
      />
      <div className={styles.divider} />
      <StatCell
        label="Total OI"
        value={fmtUsdCompact(stats.totalOiUsd)}
        sub={forwardSub ? `Basis ${forwardSub}` : undefined}
      />
    </div>
  );
}
