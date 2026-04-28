import type { ReactNode } from 'react';

import type { ChainStats } from '@shared/enriched';
import type { WsConnectionState } from '@oggregator/protocol';

import { fmtUsd, fmtUsdCompact, fmtIv, fmtPct, fmtNum } from '@lib/format';
import HoverTooltip from '@components/ui/HoverTooltip';
import type { StatsResponse } from './queries';
import RegimeChip from './RegimeChip';
import BasisTooltip from './BasisTooltip';
import styles from './StatStrip.module.css';

interface StatStripProps {
  stats: ChainStats;
  underlying: string;
  dte: number;
  connectionState?: WsConnectionState;
  marketStats?: StatsResponse | null;
}

interface StatCellProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  positive?: boolean | null; // true = green, false = red, null/undefined = neutral
  subPositive?: boolean | null;
  subTooltip?: ReactNode;
}

function StatCell({
  label,
  value,
  sub,
  accent,
  positive,
  subPositive,
  subTooltip,
}: StatCellProps) {
  return (
    <div className={styles.cell}>
      <span className={styles.label}>{label}</span>
      <span
        className={styles.value}
        data-accent={accent}
        data-positive={positive === true ? 'true' : positive === false ? 'false' : undefined}
      >
        {value}
      </span>
      {sub &&
        (subTooltip ? (
          <HoverTooltip
            as="span"
            className={styles.sub}
            placement="bottom-start"
            content={subTooltip}
            dataPositive={
              subPositive === true ? 'true' : subPositive === false ? 'false' : undefined
            }
            dataInteractive="true"
          >
            {sub}
          </HoverTooltip>
        ) : (
          <span
            className={styles.sub}
            data-positive={
              subPositive === true ? 'true' : subPositive === false ? 'false' : undefined
            }
          >
            {sub}
          </span>
        ))}
    </div>
  );
}

const CONN_DISPLAY: Record<WsConnectionState, { dot: string; label: string }> = {
  live: { dot: 'var(--color-profit)', label: 'Live' },
  connecting: { dot: 'var(--text-dim)', label: 'Connecting' },
  reconnecting: { dot: 'var(--color-warning, orange)', label: 'Reconnecting' },
  stale: { dot: 'var(--color-warning, orange)', label: 'Stale' },
  error: { dot: 'var(--color-loss)', label: 'Error' },
  closed: { dot: 'var(--text-dim)', label: 'Offline' },
};

export default function StatStrip({
  stats,
  underlying,
  dte,
  connectionState,
  marketStats,
}: StatStripProps) {
  const basisSub = stats.basisPct != null ? fmtPct(stats.basisPct, 3) : undefined;
  const basisPositive =
    stats.basisPct != null ? (stats.basisPct > 0 ? true : stats.basisPct < 0 ? false : null) : null;

  const skewPositive = stats.skew25d != null ? stats.skew25d > 0 : null;

  return (
    <div className={styles.strip}>
      <StatCell
        label={`${underlying} Spot`}
        value={fmtUsd(stats.indexPriceUsd)}
        sub={
          stats.forwardPriceUsd != null
            ? `Forward ${dte}d ${fmtUsd(stats.forwardPriceUsd)}`
            : undefined
        }
      />
      <div className={styles.divider} />
      <StatCell label="ATM IV" value={fmtIv(stats.atmIv)} accent />
      <div className={styles.divider} />
      <StatCell
        label="Put/Call OI"
        value={stats.putCallOiRatio != null ? fmtNum(stats.putCallOiRatio) : '–'}
        sub={`${dte}d to expiry`}
      />
      <div className={styles.divider} />
      <StatCell
        label="25Δ Skew"
        value={stats.skew25d != null ? fmtIv(stats.skew25d) : '–'}
        sub="call − put"
        positive={skewPositive}
      />
      <div className={styles.divider} />
      <StatCell
        label="Total OI"
        value={fmtUsdCompact(stats.totalOiUsd)}
        sub={basisSub ? `Basis ${basisSub}` : undefined}
        subPositive={basisPositive}
        subTooltip={
          stats.basisPct != null && dte > 0 ? (
            <BasisTooltip basisPct={stats.basisPct} dte={dte} />
          ) : undefined
        }
      />
      {marketStats?.dvol && (
        <>
          <div className={styles.divider} />
          <StatCell
            label="IVR"
            value={`${marketStats.dvol.ivr.toFixed(0)}`}
            sub={`52w: ${fmtIv(marketStats.dvol.low52w)}–${fmtIv(marketStats.dvol.high52w)}`}
            accent
          />
          <div className={styles.divider} />
          <StatCell
            label="IV Δ1d"
            value={fmtPct(marketStats.dvol.ivChange1d * 100, 2)}
            positive={
              marketStats.dvol.ivChange1d > 0
                ? true
                : marketStats.dvol.ivChange1d < 0
                  ? false
                  : null
            }
          />
        </>
      )}
      <div className={styles.divider} />
      <RegimeChip
        basisPct={stats.basisPct}
        skew25d={stats.skew25d}
        ivChange1d={marketStats?.dvol?.ivChange1d ?? null}
        putCallOiRatio={stats.putCallOiRatio}
      />
      {connectionState && (
        <>
          <div className={styles.divider} />
          <div className={styles.cell}>
            <span className={styles.label}>Feed</span>
            <span className={styles.feedState}>
              <span
                className={styles.feedDot}
                data-state={connectionState}
                style={{ background: CONN_DISPLAY[connectionState].dot }}
              />
              {CONN_DISPLAY[connectionState].label}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
