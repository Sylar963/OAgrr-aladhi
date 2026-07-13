import type { SurfaceGridEntry, VenueQuote } from '@oggregator/core';
import type { PersistedShortStraddleSnapshot, ShortStraddleSnapshotStore } from '@oggregator/db';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TARGET_DTE_MS = 7 * DAY_MS;
const MAX_EXPIRY_DISTANCE_MS = 2 * DAY_MS;
const DEFAULT_QUOTE_MAX_AGE_MS = 60_000;

type SelectionFailureReason =
  | 'invalid_spot'
  | 'no_deribit_expiry'
  | 'expiry_outside_window'
  | 'no_valid_paired_strike';

export type ShortStraddleSnapshotSelection =
  | { snapshot: PersistedShortStraddleSnapshot; reason: null }
  | { snapshot: null; reason: SelectionFailureReason };

interface ExecutableLeg {
  bidUsd: number;
  askUsd: number;
  bidSize: number;
  askSize: number;
  markIv: number;
  delta: number;
  vega: number;
  openInterest: number;
  makerFeeUsd: number;
  takerFeeUsd: number;
  quoteTs: number;
}

interface StrikeCandidate {
  strike: number;
  forwardPriceUsd: number;
  combinedSpreadPct: number;
  call: ExecutableLeg;
  put: ExecutableLeg;
}

interface SnapshotLog {
  debug?: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

interface ShortStraddleSnapshotServiceOptions {
  quoteMaxAgeMs?: number;
  log?: SnapshotLog;
}

export function utcHourlySlotMs(now: number): number {
  return Math.floor(now / HOUR_MS) * HOUR_MS;
}

export function selectShortStraddleSnapshot(
  entries: SurfaceGridEntry[],
  spotPriceUsd: number,
  now: number,
  quoteMaxAgeMs: number = DEFAULT_QUOTE_MAX_AGE_MS,
): ShortStraddleSnapshotSelection {
  if (!isPositiveFinite(spotPriceUsd)) return { snapshot: null, reason: 'invalid_spot' };

  const targetExpiryTs = now + TARGET_DTE_MS;
  const expiries = entries
    .filter(hasDeribitQuote)
    .map((entry) => ({ entry, expiryTs: deribitExpiryTimestamp(entry.expiry) }))
    .filter(
      (candidate): candidate is { entry: SurfaceGridEntry; expiryTs: number } =>
        candidate.expiryTs != null,
    )
    .sort((a, b) => {
      const distance =
        Math.abs(a.expiryTs - targetExpiryTs) - Math.abs(b.expiryTs - targetExpiryTs);
      return distance !== 0 ? distance : a.expiryTs - b.expiryTs;
    });
  const selectedExpiry = expiries[0];
  if (selectedExpiry == null) return { snapshot: null, reason: 'no_deribit_expiry' };
  if (Math.abs(selectedExpiry.expiryTs - targetExpiryTs) > MAX_EXPIRY_DISTANCE_MS) {
    return { snapshot: null, reason: 'expiry_outside_window' };
  }

  const candidates = selectedExpiry.entry.strikes
    .map((strike) => {
      const callQuote = strike.call.venues.deribit;
      const putQuote = strike.put.venues.deribit;
      if (callQuote == null || putQuote == null) return null;
      const call = executableLeg(callQuote, now, quoteMaxAgeMs);
      const put = executableLeg(putQuote, now, quoteMaxAgeMs);
      const forwardPriceUsd = callQuote.underlyingPriceUsd;
      if (call == null || put == null || !isPositiveFinite(forwardPriceUsd)) return null;
      return {
        strike: strike.strike,
        forwardPriceUsd,
        combinedSpreadPct: spreadPct(call) + spreadPct(put),
        call,
        put,
      } satisfies StrikeCandidate;
    })
    .filter((candidate): candidate is StrikeCandidate => candidate != null)
    .sort((a, b) => {
      const distance = Math.abs(a.strike - spotPriceUsd) - Math.abs(b.strike - spotPriceUsd);
      if (distance !== 0) return distance;
      const spread = a.combinedSpreadPct - b.combinedSpreadPct;
      return spread !== 0 ? spread : a.strike - b.strike;
    });
  const selected = candidates[0];
  if (selected == null) return { snapshot: null, reason: 'no_valid_paired_strike' };

  return {
    reason: null,
    snapshot: {
      venue: 'deribit',
      underlying: 'BTC',
      sampleSlotTs: new Date(utcHourlySlotMs(now)),
      capturedAt: new Date(now),
      expiry: selectedExpiry.entry.expiry,
      expiryTs: new Date(selectedExpiry.expiryTs),
      strike: selected.strike,
      spotPriceUsd,
      forwardPriceUsd: selected.forwardPriceUsd,
      callBidUsd: selected.call.bidUsd,
      callAskUsd: selected.call.askUsd,
      callBidSize: selected.call.bidSize,
      callAskSize: selected.call.askSize,
      callMarkIv: selected.call.markIv,
      callDelta: selected.call.delta,
      callVega: selected.call.vega,
      callOpenInterest: selected.call.openInterest,
      callMakerFeeUsd: selected.call.makerFeeUsd,
      callTakerFeeUsd: selected.call.takerFeeUsd,
      callQuoteTs: new Date(selected.call.quoteTs),
      putBidUsd: selected.put.bidUsd,
      putAskUsd: selected.put.askUsd,
      putBidSize: selected.put.bidSize,
      putAskSize: selected.put.askSize,
      putMarkIv: selected.put.markIv,
      putDelta: selected.put.delta,
      putVega: selected.put.vega,
      putOpenInterest: selected.put.openInterest,
      putMakerFeeUsd: selected.put.makerFeeUsd,
      putTakerFeeUsd: selected.put.takerFeeUsd,
      putQuoteTs: new Date(selected.put.quoteTs),
    },
  };
}

export class ShortStraddleSnapshotService {
  private readonly completedSlots = new Set<number>();
  private readonly inFlightSlots = new Set<number>();
  private readonly quoteMaxAgeMs: number;
  private log: SnapshotLog;

  constructor(
    private readonly store: ShortStraddleSnapshotStore,
    options: ShortStraddleSnapshotServiceOptions = {},
  ) {
    this.quoteMaxAgeMs = options.quoteMaxAgeMs ?? DEFAULT_QUOTE_MAX_AGE_MS;
    this.log = options.log ?? console;
  }

  setLogger(log: SnapshotLog): void {
    this.log = log;
  }

  async collect(
    entries: SurfaceGridEntry[],
    spotPriceUsd: number,
    now = Date.now(),
  ): Promise<boolean> {
    const sampleSlotMs = utcHourlySlotMs(now);
    if (this.completedSlots.has(sampleSlotMs) || this.inFlightSlots.has(sampleSlotMs)) {
      this.log.debug?.(
        { sampleSlotMs, reason: 'slot_complete' },
        'short-straddle snapshot skipped',
      );
      return false;
    }

    this.inFlightSlots.add(sampleSlotMs);
    try {
      const selection = selectShortStraddleSnapshot(entries, spotPriceUsd, now, this.quoteMaxAgeMs);
      if (selection.snapshot == null) {
        this.log.debug?.(
          { sampleSlotMs, reason: selection.reason },
          'short-straddle snapshot skipped',
        );
        return false;
      }

      await this.store.writeMany([selection.snapshot]);
      this.completedSlots.add(sampleSlotMs);
      this.log.debug?.(
        {
          sampleSlotMs,
          expiry: selection.snapshot.expiry,
          strike: selection.snapshot.strike,
        },
        'short-straddle snapshot captured',
      );
      return true;
    } catch (err: unknown) {
      this.log.warn(
        { err: String(err), sampleSlotMs },
        'short-straddle snapshot collection failed',
      );
      return false;
    } finally {
      this.inFlightSlots.delete(sampleSlotMs);
    }
  }
}

function hasDeribitQuote(entry: SurfaceGridEntry): boolean {
  return entry.strikes.some(
    (strike) => strike.call.venues.deribit != null || strike.put.venues.deribit != null,
  );
}

function deribitExpiryTimestamp(expiry: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const timestamp = Date.parse(`${expiry}T08:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === expiry ? timestamp : null;
}

function executableLeg(
  quote: VenueQuote,
  now: number,
  quoteMaxAgeMs: number,
): ExecutableLeg | null {
  const bidUsd = quote.bid;
  const askUsd = quote.ask;
  const bidSize = quote.bidSize;
  const askSize = quote.askSize;
  const markIv = quote.markIv;
  const delta = quote.delta;
  const vega = quote.vega;
  const openInterest = quote.openInterest;
  const fees = quote.estimatedFees;
  const quoteTs = quote.asOfMs;
  if (
    !isPositiveFinite(bidUsd) ||
    !isPositiveFinite(askUsd) ||
    askUsd < bidUsd ||
    !isPositiveFinite(bidSize) ||
    !isPositiveFinite(askSize) ||
    !isFiniteNumber(markIv) ||
    !isFiniteNumber(delta) ||
    !isFiniteNumber(vega) ||
    !isFiniteNumber(openInterest) ||
    fees == null ||
    !isFiniteNumber(fees.maker) ||
    !isFiniteNumber(fees.taker) ||
    !isFiniteNumber(quoteTs) ||
    quoteTs > now ||
    now - quoteTs > quoteMaxAgeMs
  ) {
    return null;
  }

  return {
    bidUsd,
    askUsd,
    bidSize,
    askSize,
    markIv,
    delta,
    vega,
    openInterest,
    makerFeeUsd: fees.maker,
    takerFeeUsd: fees.taker,
    quoteTs,
  };
}

function spreadPct(leg: ExecutableLeg): number {
  return (leg.askUsd - leg.bidUsd) / ((leg.askUsd + leg.bidUsd) / 2);
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
