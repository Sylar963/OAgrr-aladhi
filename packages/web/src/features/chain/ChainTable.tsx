import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { EnrichedStrike, EnrichedSide } from '@shared/enriched';

import { VENUES } from '@lib/venue-meta';
import { venueColor } from '@lib/colors';
import { IvChip, SpreadPill, EmptyState } from '@components/ui';
import { fmtUsd, fmtDelta } from '@lib/format';
import { useIsMobile } from '@hooks/useIsMobile';
import ExpandedRow from './ExpandedRow';
import MobileStrikeCard from './MobileStrikeCard';
import QuickTrade from './QuickTrade';
import styles from './ChainTable.module.css';

interface NewChainTableProps {
  strikes: EnrichedStrike[];
  atmStrike: number | null;
  indexPrice: number | null;
  activeVenues: string[];
  myIv: number | null;
}

function fmtGamma(v: number | null): string {
  if (v == null) return '–';
  return `${Math.round(v * 1e6)}`;
}

function fmtVega(v: number | null): string {
  if (v == null) return '–';
  return `${Math.round(v)}`;
}

// ── Venue column ──────────────────────────────────────────────────────────────

interface VenueColumnProps {
  side: EnrichedSide;
  align: 'left' | 'right';
  activeVenues: string[];
}

function VenueColumn({ side, align, activeVenues }: VenueColumnProps) {
  const entries = Object.entries(side.venues).filter(([venueId]) => activeVenues.includes(venueId));

  return (
    <div className={styles.venueCol} data-align={align}>
      {entries.map(([venueId]) => {
        const meta = VENUES[venueId];
        return (
          <div key={venueId} className={styles.logoItem} title={meta?.label ?? venueId}>
            {meta?.logo ? (
              <img src={meta.logo} alt={meta?.shortLabel ?? venueId} className={styles.logo} />
            ) : (
              <span className={styles.logoFallback} style={{ color: venueColor(venueId) }}>
                {meta?.shortLabel ?? venueId.slice(0, 3).toUpperCase()}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface BestBidAskResult {
  bid: number | null;
  ask: number | null;
  bidVenue: string | null;
  askVenue: string | null;
}

function bestBidAsk(side: EnrichedSide, activeVenues: string[]): BestBidAskResult {
  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  let bestBidVenue: string | null = null;
  let bestAskVenue: string | null = null;

  for (const [venueId, quote] of Object.entries(side.venues)) {
    if (!activeVenues.includes(venueId) || !quote) continue;

    if (quote.bid != null && (bestBid == null || quote.bid > bestBid)) {
      bestBid = quote.bid;
      bestBidVenue = venueId;
    }

    if (quote.ask != null && (bestAsk == null || quote.ask < bestAsk)) {
      bestAsk = quote.ask;
      bestAskVenue = venueId;
    }
  }

  return { bid: bestBid, ask: bestAsk, bidVenue: bestBidVenue, askVenue: bestAskVenue };
}

// ── Strike row ────────────────────────────────────────────────────────────────

interface QuickTradeInfo {
  strike: number;
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  side: EnrichedSide;
}

function PriceCell({
  value,
  venueId,
  className,
  title,
  onClick,
}: {
  value: number | null;
  venueId: string | null;
  className: string;
  title: string;
  onClick: (event: MouseEvent<HTMLSpanElement>) => void;
}) {
  const meta = venueId ? VENUES[venueId] : null;

  return (
    <span className={className} onClick={onClick} role="button" title={title}>
      <span>{fmtUsd(value)}</span>
      {meta?.logo ? <img src={meta.logo} alt="" className={styles.priceVenueLogo} /> : null}
    </span>
  );
}

interface StrikeRowProps {
  strike: EnrichedStrike;
  isAtm: boolean;
  isExpanded: boolean;
  callItm: boolean;
  putItm: boolean;
  onToggle: (strike: number) => void;
  activeVenues: string[];
  myIv: number | null;
  onQuickTrade: (info: QuickTradeInfo) => void;
}

const StrikeRowItem = memo(function StrikeRowItem({
  strike,
  isAtm,
  isExpanded,
  callItm,
  putItm,
  onToggle,
  activeVenues,
  myIv,
  onQuickTrade,
}: StrikeRowProps) {
  const callQ =
    strike.call.bestVenue != null ? (strike.call.venues[strike.call.bestVenue] ?? null) : null;
  const putQ =
    strike.put.bestVenue != null ? (strike.put.venues[strike.put.bestVenue] ?? null) : null;
  const callBba = useMemo(() => bestBidAsk(strike.call, activeVenues), [strike.call, activeVenues]);
  const putBba = useMemo(() => bestBidAsk(strike.put, activeVenues), [strike.put, activeVenues]);
  const handleToggle = useCallback(() => onToggle(strike.strike), [onToggle, strike.strike]);

  return (
    <div className={styles.rowWrap} data-expanded={isExpanded}>
      <div
        className={styles.row}
        data-atm={isAtm}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
      >
        <VenueColumn side={strike.call} align="left" activeVenues={activeVenues} />
        <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ''}`}>
          {fmtGamma(callQ?.gamma ?? null)}
        </span>
        <span className={`${styles.greekCell} ${callItm ? styles.itmCall : ''}`}>
          {fmtVega(callQ?.vega ?? null)}
        </span>
        <span className={`${styles.deltaCell} ${callItm ? styles.itmCall : ''}`}>
          {fmtDelta(callQ?.delta ?? null)}
        </span>
        <div className={`${styles.ivCell} ${callItm ? styles.itmCall : ''}`}>
          <IvChip iv={strike.call.bestIv} size="sm" />
        </div>
        <div className={`${styles.spreadCell} ${callItm ? styles.itmCall : ''}`}>
          <SpreadPill spreadPct={callQ?.spreadPct ?? null} />
        </div>
        <PriceCell
          value={callBba.bid}
          venueId={callBba.bidVenue}
          className={`${styles.bidCell} ${styles.alignRight} ${styles.clickable} ${callItm ? styles.itmCall : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onQuickTrade({
              strike: strike.strike,
              type: 'call',
              direction: 'sell',
              side: strike.call,
            });
          }}
          title="Sell call at best bid"
        />
        <PriceCell
          value={callBba.ask}
          venueId={callBba.askVenue}
          className={`${styles.askCell} ${styles.alignRight} ${styles.clickable} ${callItm ? styles.itmCall : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onQuickTrade({
              strike: strike.strike,
              type: 'call',
              direction: 'buy',
              side: strike.call,
            });
          }}
          title="Buy call at best ask"
        />

        <div
          className={styles.strikeCenter}
          data-atm={isAtm}
          data-moneyness={
            isAtm ? 'atm' : callItm ? 'itm-call' : putItm ? 'itm-put' : 'otm'
          }
        >
          {isAtm && <span className={styles.atmBadge}>ATM</span>}
          <span className={styles.strikeNum}>{strike.strike.toLocaleString()}</span>
        </div>

        <PriceCell
          value={putBba.bid}
          venueId={putBba.bidVenue}
          className={`${styles.bidCell} ${styles.clickable} ${putItm ? styles.itmPut : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onQuickTrade({
              strike: strike.strike,
              type: 'put',
              direction: 'sell',
              side: strike.put,
            });
          }}
          title="Sell put at best bid"
        />
        <PriceCell
          value={putBba.ask}
          venueId={putBba.askVenue}
          className={`${styles.askCell} ${styles.clickable} ${putItm ? styles.itmPut : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onQuickTrade({
              strike: strike.strike,
              type: 'put',
              direction: 'buy',
              side: strike.put,
            });
          }}
          title="Buy put at best ask"
        />
        <div className={`${styles.spreadCell} ${putItm ? styles.itmPut : ''}`}>
          <SpreadPill spreadPct={putQ?.spreadPct ?? null} />
        </div>
        <div className={`${styles.ivCell} ${putItm ? styles.itmPut : ''}`}>
          <IvChip iv={strike.put.bestIv} size="sm" />
        </div>
        <span className={`${styles.deltaCell} ${styles.alignRight} ${putItm ? styles.itmPut : ''}`}>
          {fmtDelta(putQ?.delta ?? null)}
        </span>
        <span className={`${styles.greekCell} ${styles.alignRight} ${putItm ? styles.itmPut : ''}`}>
          {fmtVega(putQ?.vega ?? null)}
        </span>
        <span className={`${styles.greekCell} ${styles.alignRight} ${putItm ? styles.itmPut : ''}`}>
          {fmtGamma(putQ?.gamma ?? null)}
        </span>
        <VenueColumn side={strike.put} align="right" activeVenues={activeVenues} />
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
});

// ── Root ─────────────────────────────────────────────────────────────────────

export default function NewChainTable({
  strikes,
  atmStrike,
  indexPrice,
  activeVenues,
  myIv,
}: NewChainTableProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [quickTrade, setQuickTrade] = useState<QuickTradeInfo | null>(null);
  const atmRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const isMobile = useIsMobile();

  const toggleRow = useCallback((s: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  const atmIndex = useMemo(
    () => (atmStrike != null ? strikes.findIndex((s) => s.strike === atmStrike) : -1),
    [strikes, atmStrike],
  );

  const rowVirtualizer = useVirtualizer({
    count: strikes.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => (i === atmIndex ? 72 : 48),
    overscan: 6,
    getItemKey: (i) => strikes[i]?.strike ?? i,
  });

  // Reset scroll flag when the strike set changes (expiry switch)
  const strikeCount = strikes.length;
  const firstStrike = strikes[0]?.strike;
  useEffect(() => {
    hasScrolledRef.current = false;
  }, [strikeCount, firstStrike]);

  // Scroll to ATM once per strike set, not on every live price tick
  useEffect(() => {
    if (hasScrolledRef.current) return;
    const timer = setTimeout(() => {
      if (!isMobile && atmIndex >= 0) {
        rowVirtualizer.scrollToIndex(atmIndex, { align: 'center' });
        hasScrolledRef.current = true;
        return;
      }
      if (atmRef.current && listRef.current) {
        const listRect = listRef.current.getBoundingClientRect();
        const atmRect = atmRef.current.getBoundingClientRect();
        const offset = atmRect.top - listRect.top - listRect.height / 3;
        listRef.current.scrollTop += offset;
        hasScrolledRef.current = true;
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [atmIndex, isMobile, rowVirtualizer]);

  if (strikes.length === 0) {
    return <EmptyState icon="∅" title="No options data for this expiry" />;
  }

  if (isMobile) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.list} ref={listRef}>
          {strikes.map((s) => {
            const isAtm = s.strike === atmStrike;
            return (
              <div key={s.strike} ref={isAtm ? atmRef : undefined}>
                {isAtm && indexPrice != null && (
                  <div className={styles.atmMarker}>
                    <div className={styles.atmLine} />
                    <div className={styles.atmPill}>
                      <span className={styles.atmPillText}>Index {fmtUsd(indexPrice)}</span>
                    </div>
                    <div className={styles.atmLine} />
                  </div>
                )}
                <MobileStrikeCard
                  strike={s}
                  isAtm={isAtm}
                  indexPrice={indexPrice}
                  activeVenues={activeVenues}
                  isExpanded={expanded.has(s.strike)}
                  onToggle={() => toggleRow(s.strike)}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.hdrLabel}>VENUES</span>
        <span className={styles.hdrLabel}>γ</span>
        <span className={styles.hdrLabel}>ν</span>
        <span className={styles.hdrLabel}>Δ</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel}>SPREAD</span>
        <span className={styles.hdrLabel} data-align="right">
          BID
        </span>
        <span className={styles.hdrLabel} data-align="right">
          ASK
        </span>
        <span className={styles.hdrLabel} data-align="center">
          STRIKE
        </span>
        <span className={styles.hdrLabel}>BID</span>
        <span className={styles.hdrLabel}>ASK</span>
        <span className={styles.hdrLabel}>SPREAD</span>
        <span className={styles.hdrLabel}>IV</span>
        <span className={styles.hdrLabel} data-align="right">
          Δ
        </span>
        <span className={styles.hdrLabel} data-align="right">
          ν
        </span>
        <span className={styles.hdrLabel} data-align="right">
          γ
        </span>
        <span className={styles.hdrLabel} data-align="right">
          VENUES
        </span>
      </div>

      <div className={styles.list} ref={listRef}>
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((vItem) => {
            const s = strikes[vItem.index]!;
            const isAtm = s.strike === atmStrike;
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                {isAtm && indexPrice != null && (
                  <div className={styles.atmMarker}>
                    <div className={styles.atmLine} />
                    <div className={styles.atmPill}>
                      <span className={styles.atmPillText}>Index {fmtUsd(indexPrice)}</span>
                    </div>
                    <div className={styles.atmLine} />
                  </div>
                )}
                <StrikeRowItem
                  strike={s}
                  isAtm={isAtm}
                  isExpanded={expanded.has(s.strike)}
                  callItm={indexPrice != null && s.strike < indexPrice}
                  putItm={indexPrice != null && s.strike > indexPrice}
                  onToggle={toggleRow}
                  activeVenues={activeVenues}
                  myIv={myIv}
                  onQuickTrade={setQuickTrade}
                />
              </div>
            );
          })}
        </div>
      </div>

      {quickTrade && (
        <>
          <div className={styles.backdrop} onClick={() => setQuickTrade(null)} />
          <QuickTrade
            strike={quickTrade.strike}
            type={quickTrade.type}
            direction={quickTrade.direction}
            side={quickTrade.side}
            onClose={() => setQuickTrade(null)}
          />
        </>
      )}
    </div>
  );
}
