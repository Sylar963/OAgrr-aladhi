import type {
  CloseNowAggregate,
  CloseNowLeg,
  CloseNowLegStatus,
  CloseNowPeak,
  CloseNowStrategy,
  CloseNowUnavailableReason,
  PortfolioCloseNow,
  PositionLeg,
  StrategyGroup,
} from '@oggregator/protocol';

import { cappedTakerFeeUsd, THALEX_OPTION_FEE_RATE, VENUE_FEE_CAP } from '../core/fees.js';
import { formatThalexOptionInstrument } from '../feeds/thalex-private/codec.js';
import { costToFill } from '../liquidity/analytics.js';
import type { OrderBookSnapshot } from '../liquidity/types.js';
import { VENUE_IDS, type VenueId } from '../types/common.js';
import type { MarkContext } from './types.js';

// The Thalex ticker rides the book socket at 1000ms, so a synced book whose book and ticker
// have both been silent this long means the feed stopped delivering, not a quiet market.
export const CLOSE_NOW_BOOK_SILENCE_MS = 30_000;
export const CLOSE_NOW_SPREAD_SAMPLE_MS = 15_000;
export const CLOSE_NOW_SPREAD_WINDOW_MS = 30 * 60_000;
export const CLOSE_NOW_SPREAD_MIN_SAMPLES = 8;
// Below this mark gain a give-back ratio is noise (a $0.40 gain "giving back 900%").
export const CLOSE_NOW_MIN_GIVE_BACK_BASE_USD = 1;

export type ExitBookLookup =
  | { kind: 'book'; book: OrderBookSnapshot }
  | { kind: 'unavailable'; reason: CloseNowUnavailableReason }
  | { kind: 'unsupported' };

/** Supplies the holding venue's L2 book per leg; holds subscriptions only for `sync`ed legs. */
export interface ExitBookSource {
  sync(legs: readonly PositionLeg[]): void;
  lookup(leg: PositionLeg): ExitBookLookup;
  dispose(): void;
}

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

const VENUE_SET = new Set<string>(VENUE_IDS);

function isVenueId(value: string): value is VenueId {
  return VENUE_SET.has(value);
}

/**
 * Venue whose book a close would hit. Manual and paper legs without a venue hint price on
 * Thalex, the only venue with depth books today.
 */
export function exitVenueOf(leg: PositionLeg): VenueId {
  if (leg.venueHint != null) return leg.venueHint;
  return isVenueId(leg.source) ? leg.source : 'thalex';
}

// TODO(close-now): Deribit/OKX premiums are coin-quoted; their books need the canonicalUsdMid
// conversion (premium × canonical forward / venue underlying) before walking, and Deribit's
// per-instrument taker_commission instead of a static rate.
// TODO(close-now): Derive and Paradex are USDC-linear; they need an L2 book feed and their
// instrument naming here before they can leave 'unsupported_venue'.
export function exitInstrumentOf(leg: PositionLeg, venue: VenueId): string | null {
  if (venue === 'thalex') return formatThalexOptionInstrument(leg);
  return null;
}

interface TakerFeeSchedule {
  rate: number;
  cap: number;
}

function takerFeeSchedule(venue: VenueId): TakerFeeSchedule | null {
  if (venue === 'thalex') return { rate: THALEX_OPTION_FEE_RATE, cap: VENUE_FEE_CAP.thalex };
  return null;
}

export function bookProblem(
  book: OrderBookSnapshot,
  nowMs: number,
): CloseNowUnavailableReason | null {
  if (book.state === 'uninitialized') return 'loading';
  if (book.state === 'unsynchronized') return 'unsynchronized';
  if (book.crossed) return 'crossed';
  const lastHeard = Math.max(book.receivedAt, book.mark?.receivedAt ?? 0);
  if (nowMs - lastHeard > CLOSE_NOW_BOOK_SILENCE_MS) return 'silent';
  return null;
}

function markPnlOf({ leg, mark }: LegWithMark): number | null {
  return mark.markPriceUsd != null ? (mark.markPriceUsd - leg.entryPriceUsd) * leg.size : null;
}

function withComparison(result: CloseNowLeg, markPnlUsd: number | null): CloseNowLeg {
  const exitCostUsd =
    markPnlUsd != null && result.closeNowPnlUsd != null ? markPnlUsd - result.closeNowPnlUsd : null;
  return { ...result, markPnlUsd, exitCostUsd, giveBackPct: giveBackPct(markPnlUsd, exitCostUsd) };
}

function giveBackPct(markPnlUsd: number | null, exitCostUsd: number | null): number | null {
  if (markPnlUsd == null || exitCostUsd == null) return null;
  if (markPnlUsd < CLOSE_NOW_MIN_GIVE_BACK_BASE_USD) return null;
  return (exitCostUsd / markPnlUsd) * 100;
}

function emptyLeg(
  input: LegWithMark,
  venue: VenueId,
  instrument: string | null,
  status: CloseNowLegStatus,
  reason: CloseNowUnavailableReason | null,
): CloseNowLeg {
  return withComparison(
    {
      legId: input.leg.legId,
      venue,
      instrument,
      status,
      unavailableReason: reason,
      side: input.leg.size > 0 ? 'sell' : 'buy',
      size: Math.abs(input.leg.size),
      filledSize: 0,
      exitVwapUsd: null,
      feesUsd: 0,
      exitCashUsd: null,
      venueMarkUsd: null,
      collarLimitUsd: null,
      markPnlUsd: null,
      closeNowPnlUsd: null,
      exitCostUsd: null,
      giveBackPct: null,
      spread: null,
      stale: false,
      bookAgeMs: null,
      peak: null,
    },
    markPnlOf(input),
  );
}

/**
 * Closes one leg against a usable book as a taker: a long hits the bids, a short lifts the
 * asks. The unfilled part of a long is worth 0; the unfilled part of a short has no price, so
 * its close-now P&L is null rather than a guess.
 */
export function evaluateCloseNowLeg(
  input: LegWithMark,
  venue: VenueId,
  instrument: string | null,
  book: OrderBookSnapshot,
  nowMs: number,
): CloseNowLeg {
  const { leg, mark } = input;
  const long = leg.size > 0;
  const side = long ? 'sell' : 'buy';
  const size = Math.abs(leg.size);
  const fill = costToFill(book, side, size);
  const schedule = takerFeeSchedule(venue);
  const underlying = book.mark?.indexPrice ?? mark.underlyingPriceUsd;
  const feesUsd =
    fill.vwap != null && schedule != null
      ? cappedTakerFeeUsd(schedule.rate, schedule.cap, fill.vwap, underlying, fill.filled)
      : 0;
  const entryValue = leg.entryPriceUsd * size;
  const hasFill = fill.filled > 0;

  let status: CloseNowLegStatus;
  let closeNowPnlUsd: number | null;
  let exitCashUsd: number | null;
  if (long) {
    status = !hasFill ? 'no_bid' : fill.fullyFilled ? 'ok' : 'partial';
    exitCashUsd = fill.notional - feesUsd;
    closeNowPnlUsd = exitCashUsd - entryValue;
  } else {
    status = !hasFill ? 'no_ask' : fill.fullyFilled ? 'ok' : 'partial';
    exitCashUsd = hasFill ? -(fill.notional + feesUsd) : null;
    closeNowPnlUsd = fill.fullyFilled ? entryValue - fill.notional - feesUsd : null;
  }

  const bid = book.bids[0]?.price ?? null;
  const ask = book.asks[0]?.price ?? null;
  const venueMark = book.mark != null && book.mark.markPrice > 0 ? book.mark.markPrice : null;
  const reference = venueMark ?? mark.markPriceUsd;
  const widthPct =
    bid != null && ask != null && reference != null && reference > 0
      ? ((ask - bid) / reference) * 100
      : null;
  const collar = book.mark == null ? null : long ? book.mark.collarLow : book.mark.collarHigh;

  return withComparison(
    {
      legId: leg.legId,
      venue,
      instrument,
      status,
      unavailableReason: null,
      side,
      size,
      filledSize: fill.filled,
      exitVwapUsd: fill.vwap,
      feesUsd,
      exitCashUsd,
      venueMarkUsd: venueMark,
      collarLimitUsd: collar,
      markPnlUsd: null,
      closeNowPnlUsd,
      exitCostUsd: null,
      giveBackPct: null,
      spread: {
        bidUsd: bid,
        askUsd: ask,
        widthPct,
        typicalWidthPct: null,
        widthVsTypical: null,
      },
      stale: false,
      bookAgeMs: Math.max(0, Math.round(nowMs - book.receivedAt)),
      peak: null,
    },
    markPnlOf(input),
  );
}

function sumOrNull(values: Array<number | null>): number | null {
  let total: number | null = null;
  for (const value of values) {
    if (value != null) total = (total ?? 0) + value;
  }
  return total;
}

export function aggregateCloseNow(legs: readonly CloseNowLeg[]): CloseNowAggregate {
  const pricedLegCount = legs.filter((l) => l.closeNowPnlUsd != null).length;
  const complete = pricedLegCount === legs.length;
  const markPnlUsd = legs.some((l) => l.markPnlUsd == null)
    ? null
    : legs.reduce((acc, l) => acc + (l.markPnlUsd ?? 0), 0);
  const closeNowPnlUsd = sumOrNull(legs.map((l) => l.closeNowPnlUsd));
  const exitCostUsd =
    complete && markPnlUsd != null && closeNowPnlUsd != null ? markPnlUsd - closeNowPnlUsd : null;
  return {
    markPnlUsd,
    closeNowPnlUsd,
    exitCostUsd,
    giveBackPct: giveBackPct(markPnlUsd, exitCostUsd),
    exitCashUsd: sumOrNull(legs.map((l) => l.exitCashUsd)),
    feesUsd: legs.reduce((acc, l) => acc + l.feesUsd, 0),
    legCount: legs.length,
    pricedLegCount,
    complete,
    stale: legs.some((l) => l.stale),
    peak: null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

interface SpreadHistory {
  samples: Array<{ atMs: number; widthPct: number }>;
}

interface PeakEntry {
  signature: string;
  peak: CloseNowPeak;
}

function legSignature(leg: PositionLeg): string {
  return `${leg.legId}:${leg.size}:${leg.entryPriceUsd}`;
}

const PORTFOLIO_PEAK_KEY = '__portfolio__';

/**
 * Holds the in-memory state close-now needs across ticks: the last usable result per leg (so a
 * stale book still shows its last number, greyed), spread samples per instrument, and peaks.
 * Peaks reset whenever the legs behind them change size or entry; nothing is persisted.
 */
export class CloseNowTracker {
  private readonly lastGood = new Map<string, { signature: string; result: CloseNowLeg; bookReceivedAt: number }>();
  private readonly spreads = new Map<string, SpreadHistory>();
  private readonly peaks = new Map<string, PeakEntry>();

  compute(
    withMarks: readonly LegWithMark[],
    strategies: readonly StrategyGroup[],
    lookup: (leg: PositionLeg) => ExitBookLookup,
    nowMs: number,
  ): PortfolioCloseNow {
    const legs = withMarks.map((input) => this.legResult(input, lookup(input.leg), nowMs));
    const byId = new Map(legs.map((l) => [l.legId, l]));
    const signatures = new Map(withMarks.map(({ leg }) => [leg.legId, legSignature(leg)]));

    const strategyRows: CloseNowStrategy[] = strategies.map((group) => {
      const groupLegs = group.legIds
        .map((id) => byId.get(id))
        .filter((l): l is CloseNowLeg => l != null);
      const aggregate = aggregateCloseNow(groupLegs);
      const signature = group.legIds.map((id) => signatures.get(id) ?? id).sort().join('|');
      return { groupId: group.groupId, ...aggregate, peak: this.trackAggregatePeak(group.groupId, signature, aggregate, nowMs) };
    });

    const portfolio = aggregateCloseNow(legs);
    const portfolioSignature = [...signatures.values()].sort().join('|');
    portfolio.peak = this.trackAggregatePeak(PORTFOLIO_PEAK_KEY, portfolioSignature, portfolio, nowMs);

    this.prune(new Set(signatures.keys()), new Set(strategies.map((g) => g.groupId)), legs);
    return { computedAt: nowMs, legs, strategies: strategyRows, portfolio };
  }

  private legResult(input: LegWithMark, lookup: ExitBookLookup, nowMs: number): CloseNowLeg {
    const venue = exitVenueOf(input.leg);
    const instrument = exitInstrumentOf(input.leg, venue);
    if (lookup.kind === 'unsupported') {
      return emptyLeg(input, venue, instrument, 'unsupported_venue', null);
    }
    const problem = lookup.kind === 'book' ? bookProblem(lookup.book, nowMs) : lookup.reason;
    if (lookup.kind === 'unavailable' || problem != null) {
      return this.staleOrEmpty(input, venue, instrument, problem ?? 'loading', nowMs);
    }

    const evaluated = evaluateCloseNowLeg(input, venue, instrument, lookup.book, nowMs);
    const result: CloseNowLeg = {
      ...evaluated,
      spread:
        evaluated.spread == null || instrument == null
          ? evaluated.spread
          : this.withTypicalSpread(instrument, evaluated.spread, nowMs),
    };
    const signature = legSignature(input.leg);
    this.lastGood.set(input.leg.legId, { signature, result, bookReceivedAt: lookup.book.receivedAt });
    return { ...result, peak: this.trackLegPeak(input.leg, signature, result, nowMs) };
  }

  private staleOrEmpty(
    input: LegWithMark,
    venue: VenueId,
    instrument: string | null,
    reason: CloseNowUnavailableReason,
    nowMs: number,
  ): CloseNowLeg {
    const signature = legSignature(input.leg);
    const previous = this.lastGood.get(input.leg.legId);
    if (previous == null || previous.signature !== signature) {
      return emptyLeg(input, venue, instrument, 'book_unavailable', reason);
    }
    const peak = this.peaks.get(input.leg.legId);
    return withComparison(
      {
        ...previous.result,
        unavailableReason: reason,
        stale: true,
        bookAgeMs: Math.max(0, Math.round(nowMs - previous.bookReceivedAt)),
        peak: peak?.signature === signature ? peak.peak : null,
      },
      markPnlOf(input),
    );
  }

  private withTypicalSpread(
    instrument: string,
    spread: NonNullable<CloseNowLeg['spread']>,
    nowMs: number,
  ): NonNullable<CloseNowLeg['spread']> {
    let history = this.spreads.get(instrument);
    if (history == null) {
      history = { samples: [] };
      this.spreads.set(instrument, history);
    }
    const last = history.samples.at(-1);
    if (spread.widthPct != null && (last == null || nowMs - last.atMs >= CLOSE_NOW_SPREAD_SAMPLE_MS)) {
      history.samples.push({ atMs: nowMs, widthPct: spread.widthPct });
    }
    const cutoff = nowMs - CLOSE_NOW_SPREAD_WINDOW_MS;
    while (history.samples.length > 0 && history.samples[0]!.atMs < cutoff) history.samples.shift();

    const typical =
      history.samples.length >= CLOSE_NOW_SPREAD_MIN_SAMPLES
        ? median(history.samples.map((s) => s.widthPct))
        : null;
    const widthVsTypical =
      typical != null && typical > 0 && spread.widthPct != null ? spread.widthPct / typical : null;
    return { ...spread, typicalWidthPct: typical, widthVsTypical };
  }

  private trackLegPeak(
    leg: PositionLeg,
    signature: string,
    result: CloseNowLeg,
    nowMs: number,
  ): CloseNowPeak | null {
    return this.trackPeak(leg.legId, signature, result.closeNowPnlUsd, result.markPnlUsd, nowMs);
  }

  private trackAggregatePeak(
    key: string,
    signature: string,
    aggregate: CloseNowAggregate,
    nowMs: number,
  ): CloseNowPeak | null {
    const value = aggregate.complete && !aggregate.stale ? aggregate.closeNowPnlUsd : null;
    return this.trackPeak(key, signature, value, aggregate.markPnlUsd, nowMs);
  }

  private trackPeak(
    key: string,
    signature: string,
    value: number | null,
    markPnlUsd: number | null,
    nowMs: number,
  ): CloseNowPeak | null {
    let entry = this.peaks.get(key);
    if (entry != null && entry.signature !== signature) {
      this.peaks.delete(key);
      entry = undefined;
    }
    if (value == null) return entry?.peak ?? null;
    if (entry == null || value > entry.peak.closeNowPnlUsd) {
      entry = { signature, peak: { closeNowPnlUsd: value, atMs: nowMs, markPnlUsd } };
      this.peaks.set(key, entry);
    }
    return entry.peak;
  }

  private prune(legIds: Set<string>, groupIds: Set<string>, legs: readonly CloseNowLeg[]): void {
    for (const id of this.lastGood.keys()) if (!legIds.has(id)) this.lastGood.delete(id);
    for (const key of this.peaks.keys()) {
      if (key !== PORTFOLIO_PEAK_KEY && !legIds.has(key) && !groupIds.has(key)) this.peaks.delete(key);
    }
    const instruments = new Set(legs.map((l) => l.instrument).filter((i): i is string => i != null));
    for (const instrument of this.spreads.keys()) {
      if (!instruments.has(instrument)) this.spreads.delete(instrument);
    }
  }
}
