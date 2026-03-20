import { useState, useRef, useEffect } from "react";

import type { EnrichedStrike, EnrichedSide } from "@shared/enriched";

import { IvChip, SpreadPill, VenueDot } from "@components/ui";
import { fmtUsd, fmtDelta } from "@lib/format";
import ExpandedRow from "./ExpandedRow";
import styles from "./NewChainTable.module.css";

interface NewChainTableProps {
  strikes:      EnrichedStrike[];
  atmStrike:    number | null;
  forwardPrice: number | null;
  activeVenues: string[];
  myIv:         number | null;
}

interface SideCellProps {
  side:         EnrichedSide;
  type:         "call" | "put";
  isItm:        boolean;
  activeVenues: string[];
}

function SideCell({ side, type, isItm, activeVenues }: SideCellProps) {
  const venueEntries = Object.entries(side.venues).filter(
    ([v]) => activeVenues.includes(v),
  );

  if (venueEntries.length === 0) {
    return (
      <div
        className={styles.cell}
        data-empty="true"
        data-itm={isItm}
        data-type={type}
      />
    );
  }

  const bestVenue = side.bestVenue;
  const bestIv    = side.bestIv;
  const bestQuote = bestVenue != null ? side.venues[bestVenue] : null;
  const mid       = bestQuote?.mid ?? null;
  const spread    = bestQuote?.spreadPct ?? null;
  const delta     = bestQuote?.delta ?? null;

  const midEl = (
    <span className={styles.midPrice}>{fmtUsd(mid)}</span>
  );
  const ivEl = (
    <div className={styles.ivChipWrap}>
      <IvChip iv={bestIv} size="sm" />
    </div>
  );
  const deltaEl = (
    <span className={styles.delta}>{fmtDelta(delta)}</span>
  );
  const spreadEl = (
    <div className={styles.spreadWrap}>
      <SpreadPill spreadPct={spread} />
    </div>
  );
  const dotsEl = (
    <div className={styles.venueDots}>
      {venueEntries.map(([venueId]) => (
        <VenueDot
          key={venueId}
          venueId={venueId}
          isBest={venueId === bestVenue}
        />
      ))}
    </div>
  );

  // Call DOM order: MID | IV | Δ | SPREAD | VENUES
  // Put DOM order:  VENUES | SPREAD | Δ | IV | MID  (mirrors grid columns)
  const children = type === "call"
    ? [midEl, ivEl, deltaEl, spreadEl, dotsEl]
    : [dotsEl, spreadEl, deltaEl, ivEl, midEl];

  return (
    <div className={styles.cell} data-type={type} data-itm={isItm}>
      {children}
    </div>
  );
}

interface StrikeRowProps {
  strike:       EnrichedStrike;
  isAtm:        boolean;
  isExpanded:   boolean;
  forwardPrice: number | null;
  onToggle:     () => void;
  activeVenues: string[];
  myIv:         number | null;
}

function StrikeRowItem({
  strike,
  isAtm,
  isExpanded,
  forwardPrice,
  onToggle,
  activeVenues,
  myIv,
}: StrikeRowProps) {
  const callItm = forwardPrice != null && strike.strike < forwardPrice;
  const putItm  = forwardPrice != null && strike.strike > forwardPrice;

  return (
    <div className={styles.rowWrap} data-expanded={isExpanded}>
      <div
        className={styles.row}
        data-atm={isAtm}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Call side */}
        <SideCell
          side={strike.call}
          type="call"
          isItm={callItm}
          activeVenues={activeVenues}
        />

        {/* Center strike */}
        <div className={styles.strikeCenter} data-atm={isAtm}>
          {isAtm && <span className={styles.atmBadge}>ATM</span>}
          <span className={styles.strikeNum}>{strike.strike.toLocaleString()}</span>
        </div>

        {/* Put side */}
        <SideCell
          side={strike.put}
          type="put"
          isItm={putItm}
          activeVenues={activeVenues}
        />
      </div>

      {isExpanded && (
        <ExpandedRow
          strike={strike.strike}
          callSide={strike.call}
          putSide={strike.put}
          myIv={myIv}
        />
      )}
    </div>
  );
}

export default function NewChainTable({
  strikes,
  atmStrike,
  forwardPrice,
  activeVenues,
  myIv,
}: NewChainTableProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const atmRef  = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll ATM into view whenever strikes change (new expiry loaded)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (atmRef.current && listRef.current) {
        const listRect = listRef.current.getBoundingClientRect();
        const atmRect  = atmRef.current.getBoundingClientRect();
        const offset   = atmRect.top - listRect.top - listRect.height / 3;
        listRef.current.scrollTop += offset;
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [atmStrike]);

  if (strikes.length === 0) {
    return <div className={styles.empty}>No options data for this expiry.</div>;
  }

  function toggleRow(s: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  return (
    <div className={styles.wrapper}>
      {/* Column headers */}
      <div className={styles.header}>
        <div className={styles.headerSide} data-side="call">
          <span>MID</span>
          <span>IV</span>
          <span>Δ</span>
          <span>SPREAD</span>
          <span>VENUES</span>
        </div>
        <div className={styles.headerStrike}>STRIKE</div>
        <div className={styles.headerSide} data-side="put">
          <span>VENUES</span>
          <span>SPREAD</span>
          <span>Δ</span>
          <span>IV</span>
          <span>MID</span>
        </div>
      </div>

      <div className={styles.list} ref={listRef}>
        {strikes.map((s) => {
          const isAtm = s.strike === atmStrike;
          return (
            <div key={s.strike} ref={isAtm ? atmRef : undefined}>
              {isAtm && forwardPrice != null && (
                <div className={styles.atmMarker}>
                  <div className={styles.atmLine} />
                  <div className={styles.atmPill}>
                    <span className={styles.atmPillText}>
                      Fwd {fmtUsd(forwardPrice)}
                    </span>
                  </div>
                  <div className={styles.atmLine} />
                </div>
              )}
              <StrikeRowItem
                strike={s}
                isAtm={isAtm}
                isExpanded={expanded.has(s.strike)}
                forwardPrice={forwardPrice}
                onToggle={() => toggleRow(s.strike)}
                activeVenues={activeVenues}
                myIv={myIv}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
