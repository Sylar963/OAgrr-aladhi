import type { VenueId } from '../types/common.js';
import { feedLogger } from '../utils/logger.js';

const log = feedLogger('mark-history-buffer');

export interface RawCandle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
}

export interface MarkHistoryBufferOptions {
  /** Base bucket size for stored OHLC. Default 60s. Query intervals must be a multiple. */
  bucketMs?: number;
  /** Sliding window retained per instrument. Default 7 days. */
  retentionMs?: number;
  /** How long base buckets stay at full resolution before being rolled into coarse buckets. Default 1h. */
  fineRetentionMs?: number;
  /** Bucket size for history older than `fineRetentionMs`. Default 1h; must be a multiple of `bucketMs`. */
  coarseBucketMs?: number;
  /** Hard cap on buckets across all instruments and streams; oldest buckets are evicted first. Default 1.5M. */
  maxBuckets?: number;
  /** Minimum spacing between maintenance sweeps, measured on tick timestamps. Default 60s. */
  sweepIntervalMs?: number;
}

interface CandleSeries {
  fine: Map<number, RawCandle>;
  coarse: Map<number, RawCandle>;
}

interface InstrumentStore {
  mark: CandleSeries;
  trade: CandleSeries;
}

const DEFAULT_BUCKET_MS = 60_000;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_FINE_RETENTION_MS = 60 * 60 * 1000;
const DEFAULT_COARSE_BUCKET_MS = 60 * 60 * 1000;
// Feeds record roughly 10k instruments per minute (every Deribit strike ticks a mark), at
// ~250 bytes of heap per bucket. Without the coarse tier and cap the 7-day window grows by
// ~140 MB/hour toward tens of GB.
const DEFAULT_MAX_BUCKETS = 1_500_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const EVICTION_HEADROOM = 0.9;

function emptySeries(): CandleSeries {
  return { fine: new Map(), coarse: new Map() };
}

function seriesSize(series: CandleSeries): number {
  return series.fine.size + series.coarse.size;
}

/**
 * Rolling per-instrument OHLC buffer fed by live feeds, used for venues whose
 * REST API does not expose mark-price-history or trade-history endpoints
 * (Derive being the motivating case — `public/get_trade_history` returns
 * sparse/empty data for low-volume contracts like HYPE options, and no
 * mark-price-history endpoint exists at all).
 *
 * Two parallel streams per `(venue, exchangeSymbol)` key:
 *   - mark   — appended on every quote tick where mark price is known
 *   - trade  — appended on every live trade event
 *
 * Recent history is kept at 1-minute granularity; buckets older than
 * `fineRetentionMs` are rolled into `coarseBucketMs` candles, and a global
 * `maxBuckets` cap evicts the oldest buckets so memory stays bounded however
 * long the process runs. Query-time re-bucketing rolls stored buckets up to the
 * requested interval; coarse history is returned at its stored resolution.
 */
export class MarkHistoryBuffer {
  private readonly bucketMs: number;
  private readonly retentionMs: number;
  private readonly fineRetentionMs: number;
  private readonly coarseBucketMs: number;
  private readonly maxBuckets: number;
  private readonly sweepIntervalMs: number;
  private readonly stores = new Map<string, InstrumentStore>();
  private lastSweepTs = Number.NEGATIVE_INFINITY;

  constructor(options: MarkHistoryBufferOptions = {}) {
    this.bucketMs = options.bucketMs ?? DEFAULT_BUCKET_MS;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.fineRetentionMs = options.fineRetentionMs ?? DEFAULT_FINE_RETENTION_MS;
    this.coarseBucketMs = options.coarseBucketMs ?? DEFAULT_COARSE_BUCKET_MS;
    this.maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (this.coarseBucketMs % this.bucketMs !== 0) {
      throw new RangeError('MarkHistoryBuffer: coarseBucketMs must be a multiple of bucketMs');
    }
  }

  recordMark(venue: VenueId, exchangeSymbol: string, ts: number, mark: number | null): void {
    if (mark == null || !Number.isFinite(mark) || mark <= 0) return;
    if (!Number.isFinite(ts) || ts <= 0) return;

    const store = this.ensureStore(venue, exchangeSymbol);
    appendOhlc(store.mark.fine, this.bucketMs, ts, mark, 0);
    this.maybeSweep(ts);
  }

  recordTrade(
    venue: VenueId,
    exchangeSymbol: string,
    ts: number,
    price: number,
    size: number,
  ): void {
    if (!Number.isFinite(price) || price <= 0) return;
    if (!Number.isFinite(ts) || ts <= 0) return;
    const vol = Number.isFinite(size) && size > 0 ? size : 0;

    const store = this.ensureStore(venue, exchangeSymbol);
    appendOhlc(store.trade.fine, this.bucketMs, ts, price, vol);
    this.maybeSweep(ts);
  }

  /**
   * Returns mark candles at the requested interval covering [now - rangeMs, now].
   * Empty when the buffer has no recorded ticks for this instrument yet.
   */
  getMarkCandles(
    venue: VenueId,
    exchangeSymbol: string,
    intervalMs: number,
    rangeMs: number,
  ): RawCandle[] {
    const store = this.stores.get(this.key(venue, exchangeSymbol));
    if (!store) return [];
    return this.queryBucketed(store.mark, intervalMs, rangeMs);
  }

  /**
   * Returns trade-bucketed candles (with summed volume) at the requested
   * interval covering [now - rangeMs, now].
   */
  getTradeCandles(
    venue: VenueId,
    exchangeSymbol: string,
    intervalMs: number,
    rangeMs: number,
  ): RawCandle[] {
    const store = this.stores.get(this.key(venue, exchangeSymbol));
    if (!store) return [];
    return this.queryBucketed(store.trade, intervalMs, rangeMs);
  }

  hasMark(venue: VenueId, exchangeSymbol: string): boolean {
    const store = this.stores.get(this.key(venue, exchangeSymbol));
    return store != null && seriesSize(store.mark) > 0;
  }

  hasTrade(venue: VenueId, exchangeSymbol: string): boolean {
    const store = this.stores.get(this.key(venue, exchangeSymbol));
    return store != null && seriesSize(store.trade) > 0;
  }

  stats(): { instruments: number; markBuckets: number; tradeBuckets: number } {
    let markBuckets = 0;
    let tradeBuckets = 0;
    for (const store of this.stores.values()) {
      markBuckets += seriesSize(store.mark);
      tradeBuckets += seriesSize(store.trade);
    }
    return { instruments: this.stores.size, markBuckets, tradeBuckets };
  }

  clear(): void {
    this.stores.clear();
    this.lastSweepTs = Number.NEGATIVE_INFINITY;
  }

  private key(venue: VenueId, exchangeSymbol: string): string {
    return `${venue}:${exchangeSymbol}`;
  }

  private ensureStore(venue: VenueId, exchangeSymbol: string): InstrumentStore {
    const k = this.key(venue, exchangeSymbol);
    let store = this.stores.get(k);
    if (!store) {
      store = { mark: emptySeries(), trade: emptySeries() };
      this.stores.set(k, store);
    }
    return store;
  }

  // Sweeping touches every bucket, so it is gated on tick time rather than write count:
  // a write-count trigger fires many times per second at feed rates and its cost grows
  // with the buffer.
  private maybeSweep(ts: number): void {
    if (ts - this.lastSweepTs < this.sweepIntervalMs) return;
    this.lastSweepTs = ts;
    this.sweep(ts);
  }

  private sweep(now: number): void {
    const retentionCutoff = now - this.retentionMs;
    // Rolled minute by minute so each sweep moves ~one bucket per instrument; the coarse
    // bucket for the current boundary hour then coexists with its remaining fine buckets.
    const fineCutoff = Math.floor((now - this.fineRetentionMs) / this.bucketMs) * this.bucketMs;
    let total = 0;
    // Insertion order also bounds compaction to buckets that just aged out of the fine window.
    for (const [k, store] of this.stores) {
      for (const series of [store.mark, store.trade]) {
        this.compact(series, fineCutoff);
        dropBefore(series.coarse, retentionCutoff);
        dropBefore(series.fine, retentionCutoff);
        total += seriesSize(series);
      }
      if (seriesSize(store.mark) === 0 && seriesSize(store.trade) === 0) this.stores.delete(k);
    }
    if (total > this.maxBuckets) this.evictOldest(total);
  }

  private compact(series: CandleSeries, fineCutoff: number): void {
    const rolled: RawCandle[] = [];
    for (const [bucket, candle] of series.fine) {
      if (bucket >= fineCutoff) break;
      series.fine.delete(bucket);
      rolled.push(candle);
    }
    if (rolled.length === 0) return;
    rolled.sort((a, b) => a.ts - b.ts);
    for (const candle of rolled) {
      const slot = Math.floor(candle.ts / this.coarseBucketMs) * this.coarseBucketMs;
      const existing = series.coarse.get(slot);
      if (!existing) {
        series.coarse.set(slot, { ...candle, ts: slot });
        continue;
      }
      if (candle.h > existing.h) existing.h = candle.h;
      if (candle.l < existing.l) existing.l = candle.l;
      existing.c = candle.c;
      existing.vol += candle.vol;
    }
  }

  // Bucket keys are aligned to bucketMs / coarseBucketMs, so a histogram by key has only a
  // few hundred distinct entries even with millions of buckets.
  private evictOldest(total: number): void {
    const counts = new Map<number, number>();
    for (const store of this.stores.values()) {
      for (const series of [store.mark, store.trade]) {
        for (const map of [series.coarse, series.fine]) {
          for (const bucket of map.keys()) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
        }
      }
    }
    const target = Math.floor(this.maxBuckets * EVICTION_HEADROOM);
    let remaining = total;
    let cutoff = Number.NEGATIVE_INFINITY;
    for (const bucket of [...counts.keys()].sort((a, b) => a - b)) {
      if (remaining <= target) break;
      remaining -= counts.get(bucket) ?? 0;
      cutoff = bucket + 1;
    }
    log.info(
      { total, maxBuckets: this.maxBuckets, cutoff },
      'mark history buffer at capacity, evicting oldest buckets',
    );
    for (const [k, store] of this.stores) {
      for (const series of [store.mark, store.trade]) {
        dropBefore(series.coarse, cutoff);
        dropBefore(series.fine, cutoff);
      }
      if (seriesSize(store.mark) === 0 && seriesSize(store.trade) === 0) this.stores.delete(k);
    }
  }

  private queryBucketed(series: CandleSeries, intervalMs: number, rangeMs: number): RawCandle[] {
    if (seriesSize(series) === 0) return [];
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return [];

    const cutoff = Date.now() - rangeMs;
    const since = Math.floor(cutoff / this.bucketMs) * this.bucketMs;
    const sorted = [...series.coarse.values(), ...series.fine.values()]
      .filter((candle) => candle.ts >= since)
      .sort((a, b) => a.ts - b.ts);

    if (intervalMs === this.bucketMs) return sorted;

    return mergeBaseBuckets(sorted, intervalMs);
  }
}

function appendOhlc(
  target: Map<number, RawCandle>,
  bucketMs: number,
  ts: number,
  price: number,
  vol: number,
): void {
  const bucket = Math.floor(ts / bucketMs) * bucketMs;
  const existing = target.get(bucket);
  if (!existing) {
    target.set(bucket, { ts: bucket, o: price, h: price, l: price, c: price, vol });
    return;
  }
  if (price > existing.h) existing.h = price;
  if (price < existing.l) existing.l = price;
  existing.c = price;
  existing.vol += vol;
}

// Maps iterate in insertion order and buckets are created in time order, so scanning stops
// at the first live bucket and a sweep costs O(expired) rather than O(stored). A rare late
// tick that opens an older bucket behind newer ones is collected once those ahead expire.
function dropBefore(map: Map<number, RawCandle>, cutoff: number): void {
  for (const bucket of map.keys()) {
    if (bucket >= cutoff) break;
    map.delete(bucket);
  }
}

/**
 * Rolls consecutive base-interval candles up to a coarser interval. Open is the
 * first bucket's open, close is the last bucket's close, high/low are the
 * window extrema, and volume sums. Buckets must be sorted ascending.
 */
export function mergeBaseBuckets(
  sorted: readonly RawCandle[],
  intervalMs: number,
): RawCandle[] {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError(`mergeBaseBuckets: intervalMs must be a finite positive number, got ${intervalMs}`);
  }
  if (sorted.length === 0) return [];
  const out: RawCandle[] = [];
  let current: RawCandle | null = null;

  for (const candle of sorted) {
    const slot = Math.floor(candle.ts / intervalMs) * intervalMs;
    if (current == null || current.ts !== slot) {
      if (current) out.push(current);
      current = { ts: slot, o: candle.o, h: candle.h, l: candle.l, c: candle.c, vol: candle.vol };
      continue;
    }
    if (candle.h > current.h) current.h = candle.h;
    if (candle.l < current.l) current.l = candle.l;
    current.c = candle.c;
    current.vol += candle.vol;
  }
  if (current) out.push(current);
  return out;
}
