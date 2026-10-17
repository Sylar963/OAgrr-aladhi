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

const DEFAULT_BUCKET_MS = 60_000;
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_FINE_RETENTION_MS = 60 * 60 * 1000;
const DEFAULT_COARSE_BUCKET_MS = 60 * 60 * 1000;
// Feeds record roughly 10k instruments per minute (every Deribit strike ticks a mark), so
// without the coarse tier and cap the 7-day window would grow without bound.
const DEFAULT_MAX_BUCKETS = 1_500_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const EVICTION_HEADROOM = 0.9;

// Six float64 slots per bucket: ts, open, high, low, close, volume. One typed array per series
// keeps a 1.5M-bucket buffer to a few hundred thousand leaf objects the GC never traces into,
// instead of 1.5M candle objects plus their Map entries.
const STRIDE = 6;
const INITIAL_BUCKETS = 8;

/** Buckets kept sorted by ts in one packed array; expiry and compaction trim the front. */
class PackedSeries {
  private data: Float64Array | null = null;
  private head = 0;
  private tail = 0;

  get size(): number {
    return this.tail - this.head;
  }

  /** Absolute index of the first live bucket whose ts is >= `bucket`. */
  private lowerBound(bucket: number): number {
    const data = this.data!;
    let lo = this.head;
    let hi = this.tail;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (data[mid * STRIDE]! < bucket) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Makes room for one more bucket at the tail: reuse the trimmed front if at most half the
  // capacity is live, otherwise double.
  private reserveOne(): void {
    if (this.data === null) {
      this.data = new Float64Array(INITIAL_BUCKETS * STRIDE);
      this.head = 0;
      this.tail = 0;
      return;
    }
    const capacity = this.data.length / STRIDE;
    if (this.tail < capacity) return;
    const size = this.size;
    if (size + 1 <= capacity / 2) {
      this.data.copyWithin(0, this.head * STRIDE, this.tail * STRIDE);
    } else {
      const next = new Float64Array(capacity * 2 * STRIDE);
      next.set(this.data.subarray(this.head * STRIDE, this.tail * STRIDE));
      this.data = next;
    }
    this.head = 0;
    this.tail = size;
  }

  /** Inserts or merges one candle; returns the slot index of the bucket. */
  private slotFor(bucket: number): { index: number; existing: boolean } {
    if (this.data !== null && this.tail > this.head) {
      const last = this.tail - 1;
      const lastTs = this.data[last * STRIDE]!;
      if (bucket === lastTs) return { index: last, existing: true };
      if (bucket < lastTs) {
        const at = this.lowerBound(bucket);
        if (this.data[at * STRIDE] === bucket) return { index: at, existing: true };
        // Late tick opening an older bucket: shift the newer buckets right by one.
        const offset = at - this.head;
        this.reserveOne();
        const data = this.data!;
        const insertAt = this.head + offset;
        data.copyWithin((insertAt + 1) * STRIDE, insertAt * STRIDE, this.tail * STRIDE);
        this.tail++;
        return { index: insertAt, existing: false };
      }
    }
    this.reserveOne();
    return { index: this.tail++, existing: false };
  }

  addTick(bucket: number, price: number, vol: number): void {
    const { index, existing } = this.slotFor(bucket);
    const data = this.data!;
    const at = index * STRIDE;
    if (!existing) {
      data[at] = bucket;
      data[at + 1] = price;
      data[at + 2] = price;
      data[at + 3] = price;
      data[at + 4] = price;
      data[at + 5] = vol;
      return;
    }
    if (price > data[at + 2]!) data[at + 2] = price;
    if (price < data[at + 3]!) data[at + 3] = price;
    data[at + 4] = price;
    data[at + 5]! += vol;
  }

  mergeCandle(slot: number, o: number, h: number, l: number, c: number, vol: number): void {
    const { index, existing } = this.slotFor(slot);
    const data = this.data!;
    const at = index * STRIDE;
    if (!existing) {
      data[at] = slot;
      data[at + 1] = o;
      data[at + 2] = h;
      data[at + 3] = l;
      data[at + 4] = c;
      data[at + 5] = vol;
      return;
    }
    if (h > data[at + 2]!) data[at + 2] = h;
    if (l < data[at + 3]!) data[at + 3] = l;
    data[at + 4] = c;
    data[at + 5]! += vol;
  }

  /** Removes buckets older than `cutoff`, passing each to `visit` in time order. */
  takeBefore(
    cutoff: number,
    visit?: (ts: number, o: number, h: number, l: number, c: number, vol: number) => void,
  ): void {
    const data = this.data;
    if (data === null) return;
    while (this.head < this.tail && data[this.head * STRIDE]! < cutoff) {
      if (visit) {
        const at = this.head * STRIDE;
        visit(data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!, data[at + 4]!, data[at + 5]!);
      }
      this.head++;
    }
    this.releaseIfSparse();
  }

  private releaseIfSparse(): void {
    if (this.data === null) return;
    const size = this.size;
    if (size === 0) {
      this.data = null;
      this.head = 0;
      this.tail = 0;
      return;
    }
    const capacity = this.data.length / STRIDE;
    if (capacity > INITIAL_BUCKETS && size * 4 <= capacity) {
      const next = new Float64Array(Math.max(INITIAL_BUCKETS, size * 2) * STRIDE);
      next.set(this.data.subarray(this.head * STRIDE, this.tail * STRIDE));
      this.data = next;
      this.head = 0;
      this.tail = size;
    }
  }

  forEachKey(visit: (ts: number) => void): void {
    const data = this.data;
    if (data === null) return;
    for (let i = this.head; i < this.tail; i++) visit(data[i * STRIDE]!);
  }

  candlesSince(since: number): RawCandle[] {
    const data = this.data;
    if (data === null) return [];
    const out: RawCandle[] = [];
    for (let i = this.lowerBound(since); i < this.tail; i++) {
      const at = i * STRIDE;
      out.push({
        ts: data[at]!,
        o: data[at + 1]!,
        h: data[at + 2]!,
        l: data[at + 3]!,
        c: data[at + 4]!,
        vol: data[at + 5]!,
      });
    }
    return out;
  }
}

interface CandleSeries {
  fine: PackedSeries;
  coarse: PackedSeries;
}

interface InstrumentStore {
  mark: CandleSeries;
  trade: CandleSeries;
}

function emptySeries(): CandleSeries {
  return { fine: new PackedSeries(), coarse: new PackedSeries() };
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
  private readonly stores = new Map<VenueId, Map<string, InstrumentStore>>();
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
    store.mark.fine.addTick(Math.floor(ts / this.bucketMs) * this.bucketMs, mark, 0);
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
    store.trade.fine.addTick(Math.floor(ts / this.bucketMs) * this.bucketMs, price, vol);
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
    const store = this.stores.get(venue)?.get(exchangeSymbol);
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
    const store = this.stores.get(venue)?.get(exchangeSymbol);
    if (!store) return [];
    return this.queryBucketed(store.trade, intervalMs, rangeMs);
  }

  hasMark(venue: VenueId, exchangeSymbol: string): boolean {
    const store = this.stores.get(venue)?.get(exchangeSymbol);
    return store != null && seriesSize(store.mark) > 0;
  }

  hasTrade(venue: VenueId, exchangeSymbol: string): boolean {
    const store = this.stores.get(venue)?.get(exchangeSymbol);
    return store != null && seriesSize(store.trade) > 0;
  }

  stats(): { instruments: number; markBuckets: number; tradeBuckets: number } {
    let instruments = 0;
    let markBuckets = 0;
    let tradeBuckets = 0;
    for (const byVenue of this.stores.values()) {
      for (const store of byVenue.values()) {
        instruments++;
        markBuckets += seriesSize(store.mark);
        tradeBuckets += seriesSize(store.trade);
      }
    }
    return { instruments, markBuckets, tradeBuckets };
  }

  clear(): void {
    this.stores.clear();
    this.lastSweepTs = Number.NEGATIVE_INFINITY;
  }

  private ensureStore(venue: VenueId, exchangeSymbol: string): InstrumentStore {
    let byVenue = this.stores.get(venue);
    if (!byVenue) {
      byVenue = new Map();
      this.stores.set(venue, byVenue);
    }
    let store = byVenue.get(exchangeSymbol);
    if (!store) {
      store = { mark: emptySeries(), trade: emptySeries() };
      byVenue.set(exchangeSymbol, store);
    }
    return store;
  }

  // Sweeping touches every series, so it is gated on tick time rather than write count:
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
    for (const byVenue of this.stores.values()) {
      for (const [symbol, store] of byVenue) {
        for (const series of [store.mark, store.trade]) {
          this.compact(series, fineCutoff);
          series.coarse.takeBefore(retentionCutoff);
          series.fine.takeBefore(retentionCutoff);
          total += seriesSize(series);
        }
        if (seriesSize(store.mark) === 0 && seriesSize(store.trade) === 0) byVenue.delete(symbol);
      }
    }
    if (total > this.maxBuckets) this.evictOldest(total);
  }

  private compact(series: CandleSeries, fineCutoff: number): void {
    const coarseMs = this.coarseBucketMs;
    series.fine.takeBefore(fineCutoff, (ts, o, h, l, c, vol) => {
      series.coarse.mergeCandle(Math.floor(ts / coarseMs) * coarseMs, o, h, l, c, vol);
    });
  }

  // Bucket keys are aligned to bucketMs / coarseBucketMs, so a histogram by key has only a
  // few hundred distinct entries even with millions of buckets.
  private evictOldest(total: number): void {
    const counts = new Map<number, number>();
    const count = (bucket: number) => counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    for (const byVenue of this.stores.values()) {
      for (const store of byVenue.values()) {
        for (const series of [store.mark, store.trade]) {
          series.coarse.forEachKey(count);
          series.fine.forEachKey(count);
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
    for (const byVenue of this.stores.values()) {
      for (const [symbol, store] of byVenue) {
        for (const series of [store.mark, store.trade]) {
          series.coarse.takeBefore(cutoff);
          series.fine.takeBefore(cutoff);
        }
        if (seriesSize(store.mark) === 0 && seriesSize(store.trade) === 0) byVenue.delete(symbol);
      }
    }
  }

  private queryBucketed(series: CandleSeries, intervalMs: number, rangeMs: number): RawCandle[] {
    if (seriesSize(series) === 0) return [];
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return [];

    const cutoff = Date.now() - rangeMs;
    const since = Math.floor(cutoff / this.bucketMs) * this.bucketMs;
    const coarse = series.coarse.candlesSince(since);
    const fine = series.fine.candlesSince(since);
    const sorted: RawCandle[] = [];
    let i = 0;
    let j = 0;
    while (i < coarse.length || j < fine.length) {
      if (j >= fine.length || (i < coarse.length && coarse[i]!.ts <= fine[j]!.ts)) {
        sorted.push(coarse[i++]!);
      } else {
        sorted.push(fine[j++]!);
      }
    }

    if (intervalMs === this.bucketMs) return sorted;

    return mergeBaseBuckets(sorted, intervalMs);
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
