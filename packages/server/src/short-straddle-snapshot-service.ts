import type { SurfaceGridEntry, VenueId, VenueQuote } from '@oggregator/core';
import type { PersistedShortStraddleSnapshot, ShortStraddleSnapshotStore } from '@oggregator/db';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TARGET_DTE_MS = 7 * DAY_MS;
const MAX_EXPIRY_DISTANCE_MS = 2 * DAY_MS;
const DEFAULT_QUOTE_MAX_AGE_MS = 60_000;

type SelectionFailureReason =
  | 'invalid_spot'
  | 'no_listed_expiry'
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
  vegaUsdPerVolPoint: number;
  openInterest: number;
  makerFeeUsd: number;
  takerFeeUsd: number;
  quoteTs: number;
}

interface StrikeCandidate {
  venue: VenueId;
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
  underlying: string,
  spotPriceUsd: number,
  now: number,
  quoteMaxAgeMs: number = DEFAULT_QUOTE_MAX_AGE_MS,
): ShortStraddleSnapshotSelection {
  const selection = selectShortStraddleSnapshots(
    entries,
    underlying,
    spotPriceUsd,
    now,
    quoteMaxAgeMs,
  );
  const snapshot = selection.snapshots[0] ?? null;
  return snapshot == null
    ? { snapshot: null, reason: selection.reason ?? 'no_valid_paired_strike' }
    : { snapshot, reason: null };
}

function selectShortStraddleSnapshots(
  entries: SurfaceGridEntry[],
  underlying: string,
  spotPriceUsd: number,
  now: number,
  quoteMaxAgeMs: number,
): { snapshots: PersistedShortStraddleSnapshot[]; reason: SelectionFailureReason | null } {
  if (!isPositiveFinite(spotPriceUsd)) return { snapshots: [], reason: 'invalid_spot' };

  const targetExpiryTs = now + TARGET_DTE_MS;
  const expiries = entries
    .filter(hasVenueQuote)
    .map((entry) => ({ entry, expiryTs: expiryTimestamp(entry.expiry) }))
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
  if (selectedExpiry == null) return { snapshots: [], reason: 'no_listed_expiry' };
  if (Math.abs(selectedExpiry.expiryTs - targetExpiryTs) > MAX_EXPIRY_DISTANCE_MS) {
    return { snapshots: [], reason: 'expiry_outside_window' };
  }

  const candidates = selectedExpiry.entry.strikes
    .flatMap((strike) => {
      const venues = Object.keys(strike.call.venues) as VenueId[];
      return venues.flatMap((venue) => {
        const callQuote = strike.call.venues[venue];
        const putQuote = strike.put.venues[venue];
        if (callQuote == null || putQuote == null) return [];
        const call = executableLeg(callQuote, now, quoteMaxAgeMs);
        const put = executableLeg(putQuote, now, quoteMaxAgeMs);
        const forwardPriceUsd = callQuote.underlyingPriceUsd ?? putQuote.underlyingPriceUsd;
        if (call == null || put == null || !isPositiveFinite(forwardPriceUsd)) return [];
        return [{
          venue,
          strike: strike.strike,
          forwardPriceUsd,
          combinedSpreadPct: spreadPct(call) + spreadPct(put),
          call,
          put,
        } satisfies StrikeCandidate];
      });
    })
    .sort((a, b) => {
      const distance = Math.abs(a.strike - spotPriceUsd) - Math.abs(b.strike - spotPriceUsd);
      if (distance !== 0) return distance;
      const spread = a.combinedSpreadPct - b.combinedSpreadPct;
      if (spread !== 0) return spread;
      const strike = a.strike - b.strike;
      return strike !== 0 ? strike : a.venue.localeCompare(b.venue);
    });
  const selectedByVenue = new Map<VenueId, StrikeCandidate>();
  for (const candidate of candidates) {
    if (!selectedByVenue.has(candidate.venue)) selectedByVenue.set(candidate.venue, candidate);
  }
  if (selectedByVenue.size === 0) return { snapshots: [], reason: 'no_valid_paired_strike' };

  return {
    reason: null,
    snapshots: [...selectedByVenue.values()].map((selected) => ({
      venue: selected.venue,
      underlying: underlying.toUpperCase(),
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
      callVegaUsdPerVolPoint: selected.call.vegaUsdPerVolPoint,
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
      putVegaUsdPerVolPoint: selected.put.vegaUsdPerVolPoint,
      putOpenInterest: selected.put.openInterest,
      putMakerFeeUsd: selected.put.makerFeeUsd,
      putTakerFeeUsd: selected.put.takerFeeUsd,
      putQuoteTs: new Date(selected.put.quoteTs),
    })),
  };
}

export class ShortStraddleSnapshotService {
  private readonly completedSlots = new Set<string>();
  private readonly inFlightSlots = new Set<string>();
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
    underlying: string,
    spotPriceUsd: number,
    now = Date.now(),
  ): Promise<boolean> {
    const sampleSlotMs = utcHourlySlotMs(now);
    const slotKey = `${underlying.toUpperCase()}:${sampleSlotMs}`;
    if (this.completedSlots.has(slotKey) || this.inFlightSlots.has(slotKey)) {
      this.log.debug?.(
        { sampleSlotMs, reason: 'slot_complete' },
        'short-straddle snapshot skipped',
      );
      return false;
    }

    this.inFlightSlots.add(slotKey);
    try {
      const selection = selectShortStraddleSnapshots(
        entries,
        underlying,
        spotPriceUsd,
        now,
        this.quoteMaxAgeMs,
      );
      if (selection.snapshots.length === 0) {
        this.log.debug?.(
          { sampleSlotMs, reason: selection.reason },
          'short-straddle snapshot skipped',
        );
        return false;
      }

      await this.store.writeMany(selection.snapshots);
      this.completedSlots.add(slotKey);
      this.log.debug?.(
        {
          sampleSlotMs,
          snapshots: selection.snapshots.length,
          venues: selection.snapshots.map((snapshot) => snapshot.venue),
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
      this.inFlightSlots.delete(slotKey);
    }
  }
}

function hasVenueQuote(entry: SurfaceGridEntry): boolean {
  return entry.strikes.some(
    (strike) => Object.keys(strike.call.venues).length > 0 || Object.keys(strike.put.venues).length > 0,
  );
}

function expiryTimestamp(expiry: string): number | null {
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
  const execution = quote.execution;
  const bidUsd = execution?.bidUsd;
  const askUsd = execution?.askUsd;
  const bidSize = execution?.bidSize;
  const askSize = execution?.askSize;
  const markIv = quote.markIv;
  const delta = quote.delta;
  const vegaUsdPerVolPoint = quote.vega;
  const openInterest = quote.openInterest;
  const makerFeeUsd = execution?.bidMakerFeeUsd;
  const takerFeeUsd = execution?.bidTakerFeeUsd;
  const quoteTs = quote.asOfMs;
  if (
    !isPositiveFinite(bidUsd) ||
    !isPositiveFinite(askUsd) ||
    askUsd < bidUsd ||
    !isPositiveFinite(bidSize) ||
    !isPositiveFinite(askSize) ||
    !isFiniteNumber(markIv) ||
    !isFiniteNumber(delta) ||
    !isFiniteNumber(vegaUsdPerVolPoint) ||
    !isFiniteNumber(openInterest) ||
    !isFiniteNumber(makerFeeUsd) ||
    !isFiniteNumber(takerFeeUsd) ||
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
    vegaUsdPerVolPoint,
    openInterest,
    makerFeeUsd,
    takerFeeUsd,
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
