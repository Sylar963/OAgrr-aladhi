import {
  buildLiveTradeUid,
  getVenueContractMultiplier,
  type TradeEvent,
  type VenueId,
} from '@oggregator/core';
import type { PersistedTradeRecord, TradeHistoryReader } from '@oggregator/db';

export interface IntervalFlow {
  netFlow: number;
  hasFlow: boolean;
}

export type IntervalFlowLookup = (
  venue: VenueId,
  exchangeSymbol: string,
  fromTs: number,
  toTs: number,
) => IntervalFlow;

/** One taker print, sized in base units (the same units the ingest spool stores). */
export interface TapeTrade {
  uid: string;
  venue: VenueId;
  instrument: string;
  side: 'buy' | 'sell';
  size: number;
  timestamp: number;
}

interface UnderlyingTape {
  trades: TapeTrade[];
  uids: Set<string>;
  /** Earliest ts from which the tape holds every print; Infinity until recording starts. */
  coveredFrom: number;
  /** Per venue, spans where its trade stream was down; `to` is Infinity while still down. */
  gaps: Map<VenueId, Array<{ from: number; to: number }>>;
}

const BACKFILL_PAGE_SIZE = 2_000;
// BTC/ETH print every few seconds across venues; a quieter stretch in the spool means the
// ingest worker was down, not that nobody traded.
const SPOOL_MAX_QUIET_MS = 20 * 60 * 1000;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

function bookKey(venue: VenueId, symbol: string): string {
  return `${venue}:${symbol}`;
}

/**
 * Indexes a tape once so each contract's net taker flow only scans that contract's trades.
 * An interval opening before `coveredFrom` may have lost prints, so it reports no flow and the
 * book falls back to the naive prior for that increment.
 *
 * Block trades are included with their taker side: every venue we ingest prints blocks from an
 * RFQ where the taker is the requester, the same customer-vs-liquidity-provider split assumed
 * for screen trades.
 */
export function indexIntervalFlow(
  trades: readonly TapeTrade[],
  coveredFrom: number,
  gaps: ReadonlyMap<VenueId, ReadonlyArray<{ from: number; to: number }>> = new Map(),
): IntervalFlowLookup {
  const byContract = new Map<string, TapeTrade[]>();
  for (const t of trades) {
    const key = bookKey(t.venue, t.instrument);
    const list = byContract.get(key);
    if (list) list.push(t);
    else byContract.set(key, [t]);
  }
  return (venue, exchangeSymbol, fromTs, toTs) => {
    if (coveredFrom > fromTs) return { netFlow: 0, hasFlow: false };
    for (const gap of gaps.get(venue) ?? []) {
      if (gap.from <= toTs && gap.to > fromTs) return { netFlow: 0, hasFlow: false };
    }
    let net = 0;
    let matched = false;
    for (const t of byContract.get(bookKey(venue, exchangeSymbol)) ?? []) {
      if (t.timestamp <= fromTs || t.timestamp > toTs) continue;
      net += t.side === 'buy' ? t.size : -t.size;
      matched = true;
    }
    return matched ? { netFlow: net, hasFlow: true } : { netFlow: 0, hasFlow: false };
  };
}

export function tapeTradeFromEvent(trade: TradeEvent): TapeTrade {
  return {
    uid: buildLiveTradeUid(trade),
    venue: trade.venue,
    instrument: trade.instrument,
    side: trade.side,
    size: trade.size * getVenueContractMultiplier(trade.venue, trade.underlying),
    timestamp: trade.timestamp,
  };
}

function tapeTradeFromRecord(record: PersistedTradeRecord): TapeTrade {
  return {
    uid: record.tradeUid,
    venue: record.venue as VenueId,
    instrument: record.instrumentName,
    side: record.direction,
    size: record.contracts,
    timestamp: record.tradeTs.getTime(),
  };
}

/**
 * Time-bounded taker tape for the dealer book. Interval flow used to come from the shared
 * 2 000-print ring buffer, which held ~50 min of BTC (mostly Bybit micro-lots) and silently
 * dropped coverage during bursts. This keeps every print for `retentionMs`, deduped by trade
 * uid because REST reseeds replay prints through the runtime listener.
 */
export class DealerFlowTape {
  private readonly tapes = new Map<string, UnderlyingTape>();

  constructor(
    underlyings: readonly string[],
    private readonly retentionMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    for (const u of underlyings) {
      this.tapes.set(u.toUpperCase(), {
        trades: [],
        uids: new Set(),
        coveredFrom: Infinity,
        gaps: new Map(),
      });
    }
  }

  record(underlying: string, trade: TapeTrade): void {
    const tape = this.tapes.get(underlying.toUpperCase());
    if (!tape || tape.uids.has(trade.uid)) return;
    tape.uids.add(trade.uid);
    tape.trades.push(trade);
  }

  /** The live stream for `underlying` is delivering every print from `ts` on. */
  markRecording(underlying: string, ts: number): void {
    const tape = this.tapes.get(underlying.toUpperCase());
    if (tape && ts < tape.coveredFrom) tape.coveredFrom = ts;
  }

  /**
   * Feeds the venue's trade-stream state. A disconnect opens a gap from `sinceTs` (the last time
   * the stream was known up) that closes on reconnect; intervals touching it get no flow for
   * that venue, since REST reseeds after a reconnect are not guaranteed to cover the outage.
   */
  setStreamState(
    underlying: string,
    venue: VenueId,
    connected: boolean,
    sinceTs: number,
    nowTs: number,
  ): void {
    const tape = this.tapes.get(underlying.toUpperCase());
    if (!tape) return;
    const list = tape.gaps.get(venue) ?? [];
    const open = list.length > 0 && list[list.length - 1]!.to === Infinity;
    if (!connected && !open) list.push({ from: sinceTs, to: Infinity });
    else if (connected && open) list[list.length - 1]!.to = nowTs;
    tape.gaps.set(venue, list);
  }

  coveredFrom(underlying: string): number {
    return this.tapes.get(underlying.toUpperCase())?.coveredFrom ?? Infinity;
  }

  /**
   * Fills the gap before live recording started from the ingest worker's SQLite spool. The
   * spool deletes rows after each upload, so coverage is only extended when it still holds a
   * print at or before `fromTs`, and never back across a quiet stretch where ingest was down.
   */
  async backfill(underlying: string, store: TradeHistoryReader, fromTs: number): Promise<void> {
    const key = underlying.toUpperCase();
    const tape = this.tapes.get(key);
    if (!tape || !store.enabled) return;
    const untilTs = Math.min(tape.coveredFrom, this.now());
    const startTs = Math.max(fromTs, this.now() - this.retentionMs);
    if (startTs >= untilTs) return;

    const anchor = await store.loadHistory({
      mode: 'live',
      underlying: key,
      endTs: new Date(startTs + 1),
      limit: 1,
    });
    if (anchor.length === 0) return;

    let beforeTs = new Date(untilTs);
    let beforeUid: string | undefined;
    let coveredFrom = startTs;
    let newerTs = untilTs;
    while (true) {
      const page = await store.loadHistory({
        mode: 'live',
        underlying: key,
        startTs: new Date(startTs),
        beforeTs,
        ...(beforeUid != null ? { beforeUid } : {}),
        limit: BACKFILL_PAGE_SIZE,
      });
      for (const record of page) {
        const ts = record.tradeTs.getTime();
        if (newerTs - ts > SPOOL_MAX_QUIET_MS && coveredFrom < newerTs) coveredFrom = newerTs;
        newerTs = ts;
        this.record(key, tapeTradeFromRecord(record));
      }
      if (page.length < BACKFILL_PAGE_SIZE) break;
      const last = page[page.length - 1]!;
      beforeTs = last.tradeTs;
      beforeUid = last.tradeUid;
      await yieldToEventLoop();
    }
    if (newerTs - startTs > SPOOL_MAX_QUIET_MS && coveredFrom < newerTs) coveredFrom = newerTs;
    if (coveredFrom < tape.coveredFrom) tape.coveredFrom = coveredFrom;
  }

  /** Prunes prints older than the retention window and indexes what is left. */
  lookup(underlying: string): IntervalFlowLookup {
    const tape = this.tapes.get(underlying.toUpperCase());
    if (!tape) return () => ({ netFlow: 0, hasFlow: false });
    const cutoff = this.now() - this.retentionMs;
    if (tape.trades.some((t) => t.timestamp < cutoff)) {
      tape.trades = tape.trades.filter((t) => {
        if (t.timestamp >= cutoff) return true;
        tape.uids.delete(t.uid);
        return false;
      });
    }
    if (tape.coveredFrom < cutoff) tape.coveredFrom = cutoff;
    for (const [venue, list] of tape.gaps) {
      const kept = list.filter((gap) => gap.to >= cutoff);
      if (kept.length === 0) tape.gaps.delete(venue);
      else tape.gaps.set(venue, kept);
    }
    return indexIntervalFlow(tape.trades, tape.coveredFrom, tape.gaps);
  }
}
