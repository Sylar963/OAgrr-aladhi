import {
  black76Delta,
  breakEvenHistory,
  breakEvenLevel,
  type BreakEvenSmile,
  daysToExpiry,
  historicalExceedance,
  horizonLogReturns,
  type HorizonReturns,
  impliedExceedance,
  projectBreakEven,
  selectBreakEvenStrikes,
  type VenueOptionChain,
} from '@oggregator/core';
import type { BreakEvenSnapshotStore, PersistedBreakEvenSnapshot } from '@oggregator/db';
import {
  BREAK_EVEN_RESOLUTION_SEC,
  type BreakEvenLine,
  type BreakEvenPoint,
  type BreakEvenResponse,
} from '@oggregator/protocol';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const BREAK_EVEN_SLOT_MS = BREAK_EVEN_RESOLUTION_SEC * 1000;
export const BREAK_EVEN_EXPIRY_GRACE_MS = DAY_MS;
// Longer-dated expiries still get live projections; only their history is not recorded.
export const BREAK_EVEN_MAX_RECORD_DTE = 120;
const SAMPLE_OFFSET_MS = 5_000;
const INITIAL_SAMPLE_DELAY_MS = 60_000;
// Strikes outside this call-delta band never make the chart, so they are not stored.
const RECORD_MIN_CALL_DELTA = 0.002;
const RECORD_MAX_CALL_DELTA = 0.998;
const MAX_LINES_PER_SIDE = 7;
const MIN_LOOKBACK_DAYS = 7;
const MAX_LOOKBACK_DAYS = 30;

export interface BreakEvenChainInputs {
  expiry: string;
  expiryTs: number;
  spot: number;
  forward: number;
  strikes: number[];
  markIvs: number[];
}

export interface BreakEvenSpotPoint {
  ts: number;
  close: number;
}

interface BreakEvenLog {
  debug: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}

export interface BreakEvenServiceOptions {
  underlyings: readonly string[];
  store: Pick<BreakEvenSnapshotStore, 'writeMany' | 'loadActive'>;
  listChains: (underlying: string) => Promise<BreakEvenChainInputs[]>;
  getChain: (underlying: string, expiry: string) => Promise<BreakEvenChainInputs | null>;
  /** Oldest first. */
  getDailyCloses: (underlying: string) => Promise<number[]>;
  getSpotHistory: (
    underlying: string,
    stepMs: number,
    buckets: number,
  ) => Promise<BreakEvenSpotPoint[]>;
  now?: () => number;
  log?: BreakEvenLog;
}

export function slotStart(ts: number): number {
  return Math.floor(ts / BREAK_EVEN_SLOT_MS) * BREAK_EVEN_SLOT_MS;
}

export function nextSampleDelay(now: number): number {
  return slotStart(now - SAMPLE_OFFSET_MS) + BREAK_EVEN_SLOT_MS + SAMPLE_OFFSET_MS - now;
}

/** Hourly bars keep every series on one even time grid; long expiries coarsen it. */
export function chartStepMs(dte: number): number {
  if (dte <= 45) return HOUR_MS;
  if (dte <= 180) return 4 * HOUR_MS;
  return DAY_MS;
}

export function lookbackDays(dte: number): number {
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(MIN_LOOKBACK_DAYS, Math.ceil(dte)));
}

/** Drops strikes no chart could show and rounds IV so the cache stays small. */
export function trimForRecording(
  slotTs: number,
  underlying: string,
  chain: BreakEvenChainInputs,
): PersistedBreakEvenSnapshot | null {
  const tYears = (chain.expiryTs - slotTs) / (365 * DAY_MS);
  if (!(tYears > 0) || !(chain.forward > 0) || !(chain.spot > 0)) return null;
  const strikes: number[] = [];
  const markIvs: number[] = [];
  chain.strikes.forEach((strike, index) => {
    const iv = chain.markIvs[index];
    if (iv == null || !(iv > 0)) return;
    const delta = black76Delta(chain.forward, strike, iv, tYears, 'call');
    if (delta < RECORD_MIN_CALL_DELTA || delta > RECORD_MAX_CALL_DELTA) return;
    strikes.push(strike);
    markIvs.push(Math.round(iv * 10_000) / 10_000);
  });
  if (strikes.length === 0) return null;
  return {
    underlying: underlying.toUpperCase(),
    expiry: chain.expiry,
    expiryTs: new Date(chain.expiryTs),
    slotTs: new Date(slotTs),
    spot: chain.spot,
    forward: chain.forward,
    strikes,
    markIvs,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const DEFAULT_EXPIRY_HOUR_UTC = 'T08:00:00.000Z';

/** One IV per strike: Deribit marks the call and put at a strike off the same surface. */
export function smileFromVenueChain(chain: VenueOptionChain): BreakEvenChainInputs | null {
  const ivsByStrike = new Map<number, number[]>();
  const spots: number[] = [];
  const forwards: number[] = [];
  let expiryTs: number | null = null;
  for (const contract of Object.values(chain.contracts)) {
    const iv = contract.greeks.markIv;
    if (iv != null && iv > 0) {
      const list = ivsByStrike.get(contract.strike) ?? [];
      list.push(iv);
      ivsByStrike.set(contract.strike, list);
    }
    if (contract.quote.indexPriceUsd != null) spots.push(contract.quote.indexPriceUsd);
    if (contract.quote.underlyingPriceUsd != null) forwards.push(contract.quote.underlyingPriceUsd);
    if (contract.expiryTs != null && (expiryTs == null || contract.expiryTs < expiryTs)) {
      expiryTs = contract.expiryTs;
    }
  }
  const forward = median(forwards);
  const spot = median(spots) ?? forward;
  if (forward == null || spot == null || ivsByStrike.size === 0) return null;
  const strikes = [...ivsByStrike.keys()].sort((a, b) => a - b);
  return {
    expiry: chain.expiry,
    expiryTs: expiryTs ?? Date.parse(`${chain.expiry}${DEFAULT_EXPIRY_HOUR_UTC}`),
    spot,
    forward,
    strikes,
    markIvs: strikes.map((strike) => {
      const ivs = ivsByStrike.get(strike)!;
      return ivs.reduce((sum, iv) => sum + iv, 0) / ivs.length;
    }),
  };
}

function toSmile(row: PersistedBreakEvenSnapshot): BreakEvenSmile {
  return {
    ts: row.slotTs.getTime(),
    expiryTs: row.expiryTs.getTime(),
    forward: row.forward,
    strikes: row.strikes,
    markIvs: row.markIvs,
  };
}

/** Keeps the last smile in each step bucket. */
function downsampleSmiles(smiles: readonly BreakEvenSmile[], stepMs: number): BreakEvenSmile[] {
  if (stepMs <= BREAK_EVEN_SLOT_MS) return [...smiles];
  const byBucket = new Map<number, BreakEvenSmile>();
  for (const smile of smiles) byBucket.set(Math.floor(smile.ts / stepMs) * stepMs, smile);
  return [...byBucket.entries()].map(([ts, smile]) => ({ ...smile, ts }));
}

function seriesKey(underlying: string, expiry: string): string {
  return `${underlying.toUpperCase()}:${expiry}`;
}

/**
 * Records an hourly mark-IV smile per expiry and answers break-even forecast queries from
 * memory. Storage is read once at startup; writes go through the deferred daily store.
 */
export class BreakEvenService {
  private readonly series = new Map<string, PersistedBreakEvenSnapshot[]>();
  private readonly returnsCache = new Map<string, { at: number; returns: HorizonReturns | null }>();
  private readonly now: () => number;
  private log: BreakEvenLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private started = false;

  constructor(private readonly options: BreakEvenServiceOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? { debug: () => {}, warn: (obj, msg) => console.warn(msg, obj) };
  }

  setLogger(log: BreakEvenLog): void {
    this.log = log;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const rows = await this.options.store.loadActive(
        new Date(this.now() - BREAK_EVEN_EXPIRY_GRACE_MS),
      );
      for (const row of rows) this.insert(row);
    } catch (err: unknown) {
      this.log.warn({ err: String(err) }, 'break-even history hydrate failed');
    }
    this.scheduleNext(INITIAL_SAMPLE_DELAY_MS);
  }

  dispose(): void {
    this.started = false;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
  }

  async sampleAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const slotTs = slotStart(this.now());
      this.evictExpired();
      for (const underlying of this.options.underlyings) {
        await this.sampleOne(underlying, slotTs);
      }
    } finally {
      this.running = false;
    }
  }

  async query(underlying: string, expiry: string): Promise<BreakEvenResponse | null> {
    const key = underlying.toUpperCase();
    const live = await this.options.getChain(key, expiry);
    const now = this.now();
    if (live == null || !(live.expiryTs > now) || !(live.forward > 0)) return null;

    const dte = daysToExpiry(now, live.expiryTs);
    const tYears = dte / 365;
    const stepMs = chartStepMs(dte);
    const lookback = lookbackDays(dte);
    const since = now - lookback * DAY_MS;

    const candidates = live.strikes.flatMap((strike, index) => {
      const iv = live.markIvs[index];
      if (iv == null || !(iv > 0)) return [];
      return (['call', 'put'] as const).map((right) => ({
        strike,
        right,
        iv,
        delta: black76Delta(live.forward, strike, iv, tYears, right),
      }));
    });
    const selected = selectBreakEvenStrikes(live.forward, candidates, MAX_LINES_PER_SIDE);

    const recorded = this.series.get(seriesKey(key, expiry)) ?? [];
    const smiles = downsampleSmiles(
      recorded.filter((row) => row.slotTs.getTime() >= since).map(toSmile),
      stepMs,
    );
    const [returns, spotHistory] = await Promise.all([
      this.horizonReturns(key, dte),
      this.spotHistory(key, stepMs, since, now, live.spot),
    ]);

    const lines: BreakEvenLine[] = selected.map(({ strike, right, iv, delta }) => {
      const breakEven = breakEvenLevel(live.forward, strike, iv, tYears, right);
      return {
        strike,
        right,
        markIv: iv,
        delta,
        premiumUsd: Math.abs(breakEven - strike),
        breakEven,
        impliedProb: impliedExceedance(live.forward, strike, iv, tYears, right),
        historicalProb:
          returns == null ? null : historicalExceedance(returns, live.forward, strike, right),
        history: breakEvenHistory(smiles, strike, right).filter((point) => point.ts < now),
        projection: projectBreakEven(live.forward, strike, iv, right, now, live.expiryTs, stepMs),
      };
    });

    return {
      underlying: key,
      expiry,
      expiryTs: live.expiryTs,
      asOf: now,
      spot: live.spot,
      forward: live.forward,
      resolutionSec: BREAK_EVEN_RESOLUTION_SEC,
      recordedSince: recorded[0]?.slotTs.getTime() ?? null,
      historical: {
        horizonDays: returns?.horizonDays ?? Math.max(1, Math.round(dte)),
        windows: returns?.sorted.length ?? 0,
        lookbackDays: returns == null ? 0 : returns.sorted.length + returns.horizonDays,
      },
      spotHistory,
      lines,
    };
  }

  private async horizonReturns(underlying: string, dte: number): Promise<HorizonReturns | null> {
    const horizon = Math.max(1, Math.round(dte));
    const cacheKey = `${underlying}:${horizon}`;
    const cached = this.returnsCache.get(cacheKey);
    if (cached != null && this.now() - cached.at < HOUR_MS) return cached.returns;
    try {
      const closes = await this.options.getDailyCloses(underlying);
      const returns = horizonLogReturns(closes, horizon);
      this.returnsCache.set(cacheKey, { at: this.now(), returns });
      return returns;
    } catch (err: unknown) {
      this.log.warn({ underlying, err: String(err) }, 'break-even daily closes unavailable');
      return null;
    }
  }

  private async spotHistory(
    underlying: string,
    stepMs: number,
    since: number,
    now: number,
    liveSpot: number,
  ): Promise<BreakEvenPoint[]> {
    let points: BreakEvenPoint[] = [];
    try {
      const buckets = Math.ceil((now - since) / stepMs) + 1;
      const candles = await this.options.getSpotHistory(underlying, stepMs, buckets);
      points = candles
        .filter((candle) => candle.ts >= since && candle.ts < now)
        .map((candle) => ({ ts: candle.ts, value: candle.close }));
    } catch (err: unknown) {
      this.log.warn({ underlying, err: String(err) }, 'break-even spot history unavailable');
    }
    points.push({ ts: now, value: liveSpot });
    return points;
  }

  private async sampleOne(underlying: string, slotTs: number): Promise<void> {
    const key = underlying.toUpperCase();
    try {
      const chains = await this.options.listChains(key);
      const rows: PersistedBreakEvenSnapshot[] = [];
      for (const chain of chains) {
        if (daysToExpiry(slotTs, chain.expiryTs) > BREAK_EVEN_MAX_RECORD_DTE) continue;
        const existing = this.series.get(seriesKey(key, chain.expiry));
        if (existing?.some((row) => row.slotTs.getTime() === slotTs)) continue;
        const row = trimForRecording(slotTs, key, chain);
        if (row != null) rows.push(row);
      }
      if (rows.length === 0) {
        this.log.debug({ underlying: key, slotTs }, 'break-even sample skipped: no smiles');
        return;
      }
      for (const row of rows) this.insert(row);
      await this.options.store.writeMany(rows);
    } catch (err: unknown) {
      this.log.warn({ underlying: key, err: String(err) }, 'break-even sample failed');
    }
  }

  private insert(row: PersistedBreakEvenSnapshot): void {
    const key = seriesKey(row.underlying, row.expiry);
    const list = this.series.get(key) ?? [];
    const ts = row.slotTs.getTime();
    const last = list[list.length - 1];
    if (last == null || last.slotTs.getTime() < ts) {
      list.push(row);
    } else {
      const index = list.findIndex((existing) => existing.slotTs.getTime() >= ts);
      if (list[index]?.slotTs.getTime() === ts) list[index] = row;
      else list.splice(index, 0, row);
    }
    this.series.set(key, list);
  }

  private evictExpired(): void {
    const cutoff = this.now() - BREAK_EVEN_EXPIRY_GRACE_MS;
    for (const [key, list] of this.series) {
      const expiryTs = list[0]?.expiryTs.getTime();
      if (expiryTs == null || expiryTs < cutoff) this.series.delete(key);
    }
  }

  private scheduleNext(maxDelayMs = Number.POSITIVE_INFINITY): void {
    if (!this.started) return;
    const delay = Math.min(nextSampleDelay(this.now()), maxDelayMs);
    this.timer = setTimeout(() => {
      void this.sampleAll().finally(() => this.scheduleNext());
    }, delay);
    this.timer.unref?.();
  }
}
