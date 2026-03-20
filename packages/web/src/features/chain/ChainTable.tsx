import { useState, useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import { VENUES } from "@lib/venue-meta";
import type { Comparison, ComparisonRow, NormalizedOptionContract } from "@shared/common";

import { fmtUsd, fmtIv, getSortedByAsk, getLiquidityLevel, findAtmStrike } from "./format";
import styles from "./ChainTable.module.css";

type Side = "call" | "put";

interface BuilderTarget {
  strike: number;
  side: Side;
}

interface ChainTableProps {
  comparison: Comparison;
  underlyingPrice: number;
  onOpenBuilder?: (target: BuilderTarget) => void;
}

// Heatmap: rank 0 = best (teal), higher = worse (red)
function heatColor(rank: number): string {
  switch (rank) {
    case 0:  return "rgba(80, 210, 193, 0.25)";
    case 1:  return "rgba(80, 210, 193, 0.12)";
    case 2:  return "rgba(255, 255, 255, 0.05)";
    case 3:  return "rgba(203, 56, 85, 0.10)";
    default: return "rgba(203, 56, 85, 0.18)";
  }
}

function heatBorderColor(rank: number): string {
  return rank === 0 ? "var(--accent-primary)" : "transparent";
}

// ── Liquidity bar ────────────────────────────────────────────────────────────

interface LiqBarProps {
  askSize: number | null;
  maxSize: number;
}

function LiqBar({ askSize, maxSize }: LiqBarProps) {
  const level = getLiquidityLevel(askSize);
  const pct = maxSize > 0 ? Math.min(100, ((askSize ?? 0) / maxSize) * 100) : 0;
  return (
    <div className={styles.liqTrack} title={`Ask size: ${askSize ?? "–"}`}>
      <div className={styles.liqFill} data-level={level} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Venue dot (collapsed row) ────────────────────────────────────────────────

interface VenueDotProps {
  venueId: string;
  rank: number;
}

function VenueDot({ venueId, rank }: VenueDotProps) {
  const meta = VENUES[venueId];
  return (
    <div
      className={styles.venueDot}
      style={{ background: heatColor(rank) }}
      title={`${meta?.label ?? venueId} — rank ${rank + 1}`}
    >
      <img src={meta?.logo} alt="" className={styles.dotLogo} />
      <span className={styles.dotLabel}>{meta?.shortLabel ?? venueId}</span>
    </div>
  );
}

// ── Expanded venue row ───────────────────────────────────────────────────────

interface VenueRowProps {
  venueId: string;
  contract: NormalizedOptionContract;
  rank: number;
  bestUnitPrice: number;
  qty: number;
  maxAskSize: number;
  onClick?: () => void;
}

function VenueRow({ venueId, contract, rank, bestUnitPrice, qty, maxAskSize, onClick }: VenueRowProps) {
  const meta = VENUES[venueId];
  const ask = contract.quote.ask.usd != null ? contract.quote.ask.usd * qty : null;
  const unitAsk = contract.quote.ask.usd;
  const bid = contract.quote.bid.usd;
  const spread = unitAsk != null && bid != null ? (unitAsk - bid) * qty : null;
  const iv = contract.greeks.markIv;
  const fee = contract.takerFee;
  const vsBest = unitAsk != null ? (unitAsk - bestUnitPrice) * qty : null;

  return (
    <div
      className={styles.exRow}
      style={{ background: heatColor(rank), "--row-border": heatBorderColor(rank) } as CSSProperties}
      data-best={rank === 0}
      data-clickable={onClick != null}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className={styles.exVenue}>
        <img src={meta?.logo} alt="" className={styles.exLogo} />
        <span className={styles.exLabel}>{meta?.shortLabel ?? venueId}</span>
      </div>
      <span className={styles.exPrice}>{fmtUsd(ask)}</span>
      <span className={styles.exVsBest} data-rank={rank === 0 ? "best" : "worse"}>
        {rank === 0 ? "best" : vsBest != null ? `+${fmtUsd(vsBest)}` : "–"}
      </span>
      <span className={styles.exIv}>{fmtIv(iv)}</span>
      <span className={styles.exSpread}>{spread != null ? fmtUsd(spread) : "–"}</span>
      <div className={styles.exLiqCell}>
        <LiqBar askSize={contract.quote.askSize} maxSize={maxAskSize} />
      </div>
      <span className={styles.exFee}>{fee != null ? `${(fee * 100).toFixed(2)}%` : "–"}</span>
    </div>
  );
}

// ── Strike row ───────────────────────────────────────────────────────────────

interface StrikeRowProps {
  row: ComparisonRow;
  side: Side;
  qty: number;
  isAtm: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenBuilder?: () => void;
}

function StrikeRow({ row, side, qty, isAtm, isExpanded, onToggle, onOpenBuilder }: StrikeRowProps) {
  const sideData = side === "call" ? row.call : row.put;
  const sorted = getSortedByAsk(sideData);

  if (sorted.length === 0) {
    return (
      <div className={styles.rowWrap}>
        <div className={styles.row} data-atm={isAtm} data-empty="true">
          <span className={styles.strike}>{row.strike.toLocaleString()}</span>
          <span className={styles.emptyMsg}>No data</span>
        </div>
      </div>
    );
  }

  const best = sorted[0]!;
  const second = sorted[1];
  const bestUnitPrice = best.contract.quote.ask.usd!;
  const bestPrice = bestUnitPrice * qty;
  const unitSavings =
    second?.contract.quote.ask.usd != null
      ? second.contract.quote.ask.usd - bestUnitPrice
      : null;
  const savings = unitSavings != null ? unitSavings * qty : null;
  const savingsPct =
    unitSavings != null && bestUnitPrice > 0
      ? (unitSavings / second!.contract.quote.ask.usd!) * 100
      : null;
  const bestMeta = VENUES[best.venue];
  const maxAskSize = Math.max(...sorted.map((s) => s.contract.quote.askSize ?? 0), 1);

  return (
    <div className={styles.rowWrap} data-expanded={isExpanded}>
      <div
        className={styles.row}
        data-atm={isAtm}
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={styles.strike}>{row.strike.toLocaleString()}</span>

        <div className={styles.bestPriceCell}>
          <span className={styles.bestPrice} data-side={side}>{fmtUsd(bestPrice)}</span>
          <img src={bestMeta?.logo} alt="" className={styles.winnerLogo} />
          <span className={styles.winnerLabel}>{bestMeta?.shortLabel ?? best.venue}</span>
        </div>

        <div className={styles.savingsCell}>
          {savings != null && savings > 0.5 ? (
            <span className={styles.savingsBadge}>
              save {fmtUsd(savings)}
              {savingsPct != null && savingsPct >= 1 && (
                <span className={styles.savingsPct}> · {savingsPct.toFixed(1)}%</span>
              )}
            </span>
          ) : (
            <span className={styles.savingsNone}>–</span>
          )}
        </div>

        <div className={styles.dotsCell}>
          {sorted.map(({ venue }, rank) => (
            <VenueDot key={venue} venueId={venue} rank={rank} />
          ))}
        </div>

        <button
          className={styles.chevron}
          aria-label={isExpanded ? "Collapse row" : "Expand row"}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          tabIndex={-1}
        >
          <svg
            width="10" height="6" viewBox="0 0 10 6" fill="none"
            className={styles.chevronIcon} data-expanded={isExpanded}
          >
            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {isExpanded && (
        <div className={styles.expandedPanel}>
          <div className={styles.exHeader}>
            <span>VENUE</span>
            <span>PRICE</span>
            <span>VS BEST</span>
            <span>IV</span>
            <span>SPREAD</span>
            <span>LIQUIDITY</span>
            <span>FEE</span>
          </div>
          {sorted.map(({ venue, contract }, rank) => (
            <VenueRow
              key={venue}
              venueId={venue}
              contract={contract}
              rank={rank}
              bestUnitPrice={bestUnitPrice}
              qty={qty}
              maxAskSize={maxAskSize}
              onClick={onOpenBuilder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root component ───────────────────────────────────────────────────────────

export default function ChainTable({ comparison, underlyingPrice, onOpenBuilder }: ChainTableProps) {
  const [side, setSide] = useState<Side>("call");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [qty, setQty] = useState(1);
  const atmRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (atmRef.current && listRef.current) {
        const listRect = listRef.current.getBoundingClientRect();
        const atmRect = atmRef.current.getBoundingClientRect();
        // Scroll so ATM is roughly 1/3 from top of the list
        const offset = atmRect.top - listRect.top - listRect.height / 3;
        listRef.current.scrollTop += offset;
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [comparison.expiry]);

  if (comparison.rows.length === 0) {
    return <div className={styles.empty}>No options found for this expiry.</div>;
  }

  const atmStrike = findAtmStrike(comparison.rows.map((r) => r.strike), underlyingPrice);
  const allStrikes = comparison.rows.map((r) => r.strike);
  const allExpanded = allStrikes.every((s) => expanded.has(s));

  function toggleRow(strike: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(strike)) next.delete(strike);
      else next.add(strike);
      return next;
    });
  }

  function toggleAll() {
    setExpanded(allExpanded ? new Set() : new Set(allStrikes));
  }

  // Find the index of the ATM strike so we can insert the marker before it
  const atmIndex = comparison.rows.findIndex((r) => r.strike === atmStrike);

  return (
    <div className={styles.wrapper}>
      <div className={styles.controls}>
        <div className={styles.sideToggle}>
          <button className={styles.toggleBtn} data-active={side === "call"} onClick={() => setSide("call")}>
            CALL
          </button>
          <button className={styles.toggleBtn} data-active={side === "put"} onClick={() => setSide("put")}>
            PUT
          </button>
        </div>

        <div className={styles.qtyChip}>
          <span className={styles.qtyLabel}>QTY</span>
          <input
            type="number"
            min={1}
            max={9999}
            value={qty}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1) setQty(v);
            }}
            className={styles.qtyInput}
          />
          <span className={styles.qtySuffix}>{qty === 1 ? "contract" : "contracts"}</span>
        </div>

        <button className={styles.expandAllBtn} onClick={toggleAll}>
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      <div className={styles.listHeader}>
        <span>STRIKE</span>
        <span>BEST PRICE</span>
        <span>SAVINGS</span>
        <span>VENUES</span>
        <span />
      </div>

      <div className={styles.list} ref={listRef}>
        {comparison.rows.map((row, i) => {
          const isAtm = row.strike === atmStrike;
          const showAtmMarker = i === atmIndex;

          return (
            <div key={row.strike}>
              {showAtmMarker && (
                <div className={styles.atmMarker} ref={atmRef}>
                  <div className={styles.atmLine} />
                  <div className={styles.atmPill}>
                    <span className={styles.atmPillAsset}>{comparison.underlying}</span>
                    <span className={styles.atmPillPrice}>{fmtUsd(underlyingPrice)}</span>
                  </div>
                  <div className={styles.atmLine} />
                </div>
              )}
              <StrikeRow
                row={row}
                side={side}
                qty={qty}
                isAtm={isAtm}
                isExpanded={expanded.has(row.strike)}
                onToggle={() => toggleRow(row.strike)}
                onOpenBuilder={onOpenBuilder ? () => onOpenBuilder({ strike: row.strike, side }) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
