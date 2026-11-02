import type { AggregatedSpotUnderlying } from '@oggregator/protocol';
import { JsonRpcWsClient } from '../../feeds/shared/jsonrpc-client.js';
import { TopicWsClient } from '../../feeds/shared/topic-ws-client.js';
import {
  downsampleCandles,
  spotCandleCacheTtlMs,
  type SpotCandle,
  type SpotCandleResolutionSec,
} from '../../services/spot-candles.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseDeribitTicker,
  sourceResolution,
  SPOT_VENUES,
  spotLegs,
  USDT_RATE_LEG,
  type SpotLeg,
  type SpotStreamEvent,
  type SpotVenue,
} from './spot-venues.js';

export interface VenueBar extends SpotCandle {
  volume: number;
}

export interface AggregatedBar extends VenueBar {
  venues: number;
}

export interface WeightedBar {
  bar: VenueBar;
  weight: number;
}

/**
 * The middle of the weighted distribution, averaging the two neighbours when the
 * cumulative weight lands exactly on half.
 */
export function weightedMedian(entries: readonly { value: number; weight: number }[]): number {
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const half = sorted.reduce((sum, entry) => sum + entry.weight, 0) / 2;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i]!.weight;
    if (cumulative > half) return sorted[i]!.value;
    if (cumulative === half) return (sorted[i]!.value + sorted[i + 1]!.value) / 2;
  }
  throw new Error('weightedMedian needs at least one entry');
}

/**
 * One candle from every venue's bar in a bucket. Each OHLC field takes its own
 * weighted median, so one venue's bad print can't draw a wick. That keeps the bar
 * valid too: a venue's high is at least its open, low and close, so the same order
 * statistic of those fields keeps that ordering. Volume is the sum, in base asset.
 */
export function aggregateBars(timestamp: number, inputs: readonly WeightedBar[]): AggregatedBar | null {
  if (inputs.length === 0) return null;
  const median = (field: 'open' | 'high' | 'low' | 'close') =>
    weightedMedian(inputs.map(({ bar, weight }) => ({ value: bar[field], weight })));
  return {
    timestamp,
    open: median('open'),
    high: median('high'),
    low: median('low'),
    close: median('close'),
    volume: inputs.reduce((sum, { bar }) => sum + bar.volume, 0),
    venues: inputs.length,
  };
}

export function scaleBar(bar: VenueBar, rate: number): VenueBar {
  return {
    timestamp: bar.timestamp,
    open: bar.open * rate,
    high: bar.high * rate,
    low: bar.low * rate,
    close: bar.close * rate,
    volume: bar.volume,
  };
}

export function applyTick(
  existing: VenueBar | undefined,
  timestamp: number,
  price: number,
  size: number,
): VenueBar {
  if (!existing) {
    return { timestamp, open: price, high: price, low: price, close: price, volume: size };
  }
  return {
    timestamp,
    open: existing.open,
    high: Math.max(existing.high, price),
    low: Math.min(existing.low, price),
    close: price,
    volume: existing.volume + size,
  };
}

/**
 * A REST snapshot of the forming bar arrives behind the live stream, so it may
 * widen the range and supply the true open, but never moves the close backwards.
 */
export function mergeFormingBar(existing: VenueBar, rest: VenueBar): VenueBar {
  return {
    timestamp: rest.timestamp,
    open: rest.open,
    high: Math.max(existing.high, rest.high),
    low: Math.min(existing.low, rest.low),
    close: existing.close,
    volume: Math.max(existing.volume, rest.volume),
  };
}

const log = feedLogger('spot-aggregate');

const HISTORY_DEADLINE_MS = 2_500;
const FAILED_RETRY_MS = 30_000;
const VENUE_CONCURRENCY = 2;
const FLUSH_INTERVAL_MS = 250;
const STREAM_LINGER_MS = 60_000;
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const DERIBIT_SUBSCRIBE_RETRY_MS = 5_000;
const SEEDED_BUCKETS = 3;
const SERIES_IDLE_MS = 30 * 60_000;
const SERIES_PRUNE_INTERVAL_MS = 5 * 60_000;
// Venues publish a bar's final values a moment after its boundary.
const BAR_FINAL_GRACE_MS = 3_000;

export interface AggregatedSpotCandles {
  candles: AggregatedBar[];
  sources: SpotVenue[];
}

export type AggregatedSpotListener = (candle: AggregatedBar) => void;

export interface SpotStreamTransport {
  add(topics: string[]): void;
  remove(topics: string[]): void;
  dispose(): void;
}

export interface AggregatedSpotRuntimeOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  createTransport?: (venue: SpotVenue, onEvents: (events: SpotStreamEvent[]) => void) => SpotStreamTransport;
  flushIntervalMs?: number;
}

interface SpotSeries {
  leg: SpotLeg;
  sourceRes: SpotCandleResolutionSec;
  bars: Map<number, VenueBar>;
  newestTs: number | null;
  coveredFrom: number | null;
  tailRefreshedAt: number;
  retryAt: number;
  lastReadAt: number;
  loading: Promise<void> | null;
}

interface HistoryRange {
  start: number;
  end: number;
  tail: boolean;
}

interface SpotSubscription {
  underlying: AggregatedSpotUnderlying;
  resolutionSec: SpotCandleResolutionSec;
  legs: SpotLeg[];
  listeners: Set<AggregatedSpotListener>;
  /** Joined since the last flush: they get the current candles even though nothing changed. */
  newListeners: Set<AggregatedSpotListener>;
  /** Until the forming bar's history is in, a candle would show only what streamed so far. */
  seeded: boolean;
  lastSent: Map<number, string>;
  lingerTimer: ReturnType<typeof setTimeout> | null;
}

function usdPerUsdt(usdcInUsdt: VenueBar): number {
  return 1 / usdcInUsdt.close;
}

class TopicTransport implements SpotStreamTransport {
  private readonly topics = new Set<string>();
  private readonly client: TopicWsClient;

  constructor(
    private readonly venue: SpotVenue,
    onEvents: (events: SpotStreamEvent[]) => void,
  ) {
    const def = SPOT_VENUES[venue];
    this.client = new TopicWsClient(def.url, `spot-aggregate-${venue}`, {
      ...(def.ping ? { pingIntervalMs: def.ping.intervalMs, pingMessage: def.ping.message } : {}),
      idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
      getReplayMessages: () =>
        this.topics.size === 0 ? [] : (def.subscribeMessages?.([...this.topics]) ?? []),
      onMessage: (raw) => {
        const events = def.parse?.(raw.toString()) ?? [];
        if (events.length > 0) onEvents(events);
      },
    });
  }

  add(topics: string[]): void {
    const def = SPOT_VENUES[this.venue];
    for (const topic of topics) this.topics.add(topic);
    if (this.client.isConnected) {
      for (const message of def.subscribeMessages?.(topics) ?? []) this.client.send(message);
      return;
    }
    this.client.connect().catch((error: unknown) => {
      log.warn({ venue: this.venue, err: String(error) }, 'spot stream connect failed');
    });
  }

  remove(topics: string[]): void {
    const def = SPOT_VENUES[this.venue];
    for (const topic of topics) this.topics.delete(topic);
    if (this.topics.size === 0) {
      void this.client.disconnect();
      return;
    }
    for (const message of def.unsubscribeMessages?.(topics) ?? []) this.client.send(message);
  }

  dispose(): void {
    this.topics.clear();
    void this.client.disconnect();
  }
}

// Deribit carries few spot pairs and an unused channel's ticks are ignored, so channels stay on until
// the last one goes. JsonRpcWsClient keeps its channel set across a disconnect, so a fresh client per
// session is what guarantees the next subscribe is actually sent.
class DeribitTransport implements SpotStreamTransport {
  private readonly topics = new Set<string>();
  private client: JsonRpcWsClient | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onEvents: (events: SpotStreamEvent[]) => void) {}

  add(topics: string[]): void {
    for (const topic of topics) this.topics.add(topic);
    void this.sync();
  }

  remove(topics: string[]): void {
    for (const topic of topics) this.topics.delete(topic);
    if (this.topics.size === 0) this.close();
  }

  dispose(): void {
    this.topics.clear();
    this.close();
  }

  private close(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.client?.disconnect();
    this.client = null;
  }

  private ensureClient(): JsonRpcWsClient {
    if (this.client) return this.client;
    const client = new JsonRpcWsClient(SPOT_VENUES.deribit.url, 'spot-aggregate-deribit');
    client.onSubscription((_channel, data) => {
      const events = parseDeribitTicker(data);
      if (events.length > 0) this.onEvents(events);
    });
    this.client = client;
    return client;
  }

  private async sync(): Promise<void> {
    const client = this.ensureClient();
    try {
      await client.connect();
      if (client === this.client) await client.subscribe([...this.topics], 'spot-aggregate');
    } catch (error: unknown) {
      if (client !== this.client) return;
      log.warn({ err: String(error) }, 'deribit spot stream subscribe failed');
      if (this.retryTimer) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.sync();
      }, DERIBIT_SUBSCRIBE_RETRY_MS);
      this.retryTimer.unref();
    }
  }
}

function defaultTransport(
  venue: SpotVenue,
  onEvents: (events: SpotStreamEvent[]) => void,
): SpotStreamTransport {
  return venue === 'deribit' ? new DeribitTransport(onEvents) : new TopicTransport(venue, onEvents);
}

/**
 * Candles for real spot markets, aggregated across venues. Each venue's bars are
 * kept per symbol and resolution, USDT pairs are converted to USD, and every bucket
 * is the weighted median of the venues that printed in it. History loads on demand
 * and live streams run only while someone is subscribed.
 */
export class AggregatedSpotRuntime {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly createTransport: NonNullable<AggregatedSpotRuntimeOptions['createTransport']>;
  private readonly flushIntervalMs: number;
  private readonly series = new Map<string, SpotSeries>();
  private readonly transports = new Map<SpotVenue, SpotStreamTransport>();
  private readonly topicRefs = new Map<string, number>();
  private readonly tickResolutions = new Map<string, Map<SpotCandleResolutionSec, number>>();
  private readonly subscriptions = new Map<string, SpotSubscription>();
  private readonly dirty = new Set<SpotSubscription>();
  private readonly venueSlots = new Map<SpotVenue, { active: number; waiting: (() => void)[] }>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pruneTimer: ReturnType<typeof setInterval>;

  constructor(options: AggregatedSpotRuntimeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.createTransport = options.createTransport ?? defaultTransport;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.pruneTimer = setInterval(() => this.pruneIdleSeries(), SERIES_PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  async getCandles(
    underlying: AggregatedSpotUnderlying,
    resolutionSec: SpotCandleResolutionSec,
    buckets: number,
  ): Promise<AggregatedSpotCandles> {
    const legs = spotLegs(underlying);
    const resMs = resolutionSec * 1000;
    const now = this.now();
    const startMs = Math.floor((now - resMs * buckets) / resMs) * resMs;

    const loads = [...legs, USDT_RATE_LEG].map((leg) =>
      this.ensureHistory(this.seriesFor(leg, resolutionSec), startMs, resolutionSec),
    );
    // Slow pages keep filling the store, so the next read picks up what this one missed.
    await Promise.race([
      Promise.all(loads),
      new Promise<void>((resolve) => setTimeout(resolve, HISTORY_DEADLINE_MS).unref()),
    ]);

    const rates = this.ratesFor(resolutionSec, startMs, now);
    const contributors = new Set<SpotVenue>();
    const candles: AggregatedBar[] = [];
    for (let ts = startMs, i = 0; ts <= now; ts += resMs, i++) {
      const inputs = this.bucketInputs(legs, resolutionSec, ts, rates[i] ?? null);
      for (const venue of inputs.venues) contributors.add(venue);
      const candle = aggregateBars(ts, inputs.bars);
      if (candle) candles.push(candle);
    }
    return { candles, sources: [...contributors] };
  }

  subscribe(
    underlying: AggregatedSpotUnderlying,
    resolutionSec: SpotCandleResolutionSec,
    listener: AggregatedSpotListener,
  ): () => void {
    const key = `${underlying}|${resolutionSec}`;
    let subscription = this.subscriptions.get(key);
    if (!subscription) {
      subscription = {
        underlying,
        resolutionSec,
        legs: spotLegs(underlying),
        listeners: new Set(),
        newListeners: new Set(),
        seeded: false,
        lastSent: new Map(),
        lingerTimer: null,
      };
      this.subscriptions.set(key, subscription);
      this.attachStreams(subscription);
    }
    if (subscription.lingerTimer) {
      clearTimeout(subscription.lingerTimer);
      subscription.lingerTimer = null;
    }
    subscription.listeners.add(listener);
    subscription.newListeners.add(listener);
    this.dirty.add(subscription);
    if (!subscription.seeded) this.seedForming(subscription);
    this.startFlushing();

    const active = subscription;
    return () => {
      active.listeners.delete(listener);
      active.newListeners.delete(listener);
      if (active.listeners.size > 0 || active.lingerTimer) return;
      active.lingerTimer = setTimeout(() => this.releaseSubscription(key, active), STREAM_LINGER_MS);
      active.lingerTimer.unref();
    };
  }

  dispose(): void {
    clearInterval(this.pruneTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.lingerTimer) clearTimeout(subscription.lingerTimer);
    }
    this.subscriptions.clear();
    this.dirty.clear();
    for (const transport of this.transports.values()) transport.dispose();
    this.transports.clear();
    this.topicRefs.clear();
    this.tickResolutions.clear();
    this.series.clear();
  }

  private seriesFor(leg: SpotLeg, resolutionSec: SpotCandleResolutionSec): SpotSeries {
    const sourceRes = sourceResolution(leg.venue, resolutionSec);
    const key = `${leg.venue}|${leg.symbol}|${sourceRes}`;
    let series = this.series.get(key);
    if (!series) {
      series = {
        leg,
        sourceRes,
        bars: new Map(),
        newestTs: null,
        coveredFrom: null,
        tailRefreshedAt: 0,
        retryAt: 0,
        lastReadAt: 0,
        loading: null,
      };
      this.series.set(key, series);
    }
    series.lastReadAt = this.now();
    return series;
  }

  private async ensureHistory(
    series: SpotSeries,
    startMs: number,
    resolutionSec: SpotCandleResolutionSec,
  ): Promise<void> {
    // A load already running may cover less than this caller needs, so check again once it ends.
    while (series.loading) await series.loading;

    const now = this.now();
    if (series.retryAt > now) return;
    const ranges = this.missingRanges(series, startMs, resolutionSec, now);
    if (ranges.length === 0) return;

    series.loading = this.loadRanges(series, ranges, now)
      .catch((error: unknown) => {
        series.retryAt = this.now() + FAILED_RETRY_MS;
        log.warn(
          { venue: series.leg.venue, symbol: series.leg.symbol, sourceRes: series.sourceRes, err: String(error) },
          'spot history fetch failed',
        );
      })
      .finally(() => {
        series.loading = null;
      });
    await series.loading;
  }

  private missingRanges(
    series: SpotSeries,
    startMs: number,
    resolutionSec: SpotCandleResolutionSec,
    now: number,
  ): HistoryRange[] {
    if (series.coveredFrom == null) return [{ start: startMs, end: now, tail: true }];

    const ranges: HistoryRange[] = [];
    if (now - series.tailRefreshedAt >= spotCandleCacheTtlMs(resolutionSec)) {
      const overlap = series.sourceRes * 1000 * 2;
      const start = Math.max(series.coveredFrom, (series.newestTs ?? series.coveredFrom) - overlap);
      ranges.push({ start, end: now, tail: true });
    }
    if (startMs < series.coveredFrom) {
      ranges.push({ start: startMs, end: series.coveredFrom, tail: false });
    }
    return ranges;
  }

  // Newest pages first, so a venue that runs out the deadline or fails partway still has recent
  // bars, and the next read resumes from where coverage stopped.
  private async loadRanges(
    series: SpotSeries,
    ranges: readonly HistoryRange[],
    refreshedAt: number,
  ): Promise<void> {
    const { venue, symbol } = series.leg;
    const def = SPOT_VENUES[venue];
    const interval = def.resolutions[series.sourceRes]!;
    const pageMs = def.pageBars * series.sourceRes * 1000;

    for (const range of ranges) {
      for (let pageEnd = range.end; pageEnd > range.start; pageEnd -= pageMs) {
        const pageStart = Math.max(range.start, pageEnd - pageMs);
        const requestedAt = this.now();
        const bars = await this.withVenueSlot(venue, () =>
          def.fetchPage(this.fetchImpl, symbol, interval, pageStart, pageEnd),
        );
        this.mergeHistory(series, bars, requestedAt);
        if (series.coveredFrom == null || pageStart < series.coveredFrom) {
          series.coveredFrom = pageStart;
        }
        if (range.tail) series.tailRefreshedAt = refreshedAt;
      }
    }
  }

  private mergeHistory(series: SpotSeries, bars: readonly VenueBar[], requestedAt: number): void {
    const resMs = series.sourceRes * 1000;
    // Judged by when the venue answered, not when the response landed: a bar still open at that
    // moment is partial even if it has closed by now.
    const openFrom = Math.floor((requestedAt - BAR_FINAL_GRACE_MS) / resMs) * resMs;
    for (const bar of bars) {
      // Deribit's klines repeat the last trade through empty buckets: that price is stale.
      if (!(bar.volume > 0) || !(bar.close > 0)) continue;
      const existing = series.bars.get(bar.timestamp);
      this.setBar(series, existing && bar.timestamp >= openFrom ? mergeFormingBar(existing, bar) : bar);
    }
  }

  private setBar(series: SpotSeries, bar: VenueBar): void {
    series.bars.set(bar.timestamp, bar);
    if (series.newestTs == null || bar.timestamp > series.newestTs) series.newestTs = bar.timestamp;
  }

  private async withVenueSlot<T>(venue: SpotVenue, run: () => Promise<T>): Promise<T> {
    let slots = this.venueSlots.get(venue);
    if (!slots) {
      slots = { active: 0, waiting: [] };
      this.venueSlots.set(venue, slots);
    }
    if (slots.active >= VENUE_CONCURRENCY) {
      await new Promise<void>((resolve) => slots.waiting.push(resolve));
    }
    slots.active += 1;
    try {
      return await run();
    } finally {
      slots.active -= 1;
      slots.waiting.shift()?.();
    }
  }

  private barAt(
    series: SpotSeries,
    resolutionSec: SpotCandleResolutionSec,
    timestamp: number,
  ): VenueBar | null {
    if (series.sourceRes === resolutionSec) return series.bars.get(timestamp) ?? null;
    const parts: VenueBar[] = [];
    const sourceMs = series.sourceRes * 1000;
    for (let ts = timestamp; ts < timestamp + resolutionSec * 1000; ts += sourceMs) {
      const bar = series.bars.get(ts);
      if (bar) parts.push(bar);
    }
    const rolled = downsampleCandles(parts, resolutionSec * 1000)[0];
    return rolled ? { ...rolled, volume: rolled.volume ?? 0 } : null;
  }

  private bucketInputs(
    legs: readonly SpotLeg[],
    resolutionSec: SpotCandleResolutionSec,
    timestamp: number,
    usdtRate: number | null,
  ): { bars: WeightedBar[]; venues: SpotVenue[] } {
    const bars: WeightedBar[] = [];
    const venues: SpotVenue[] = [];
    for (const leg of legs) {
      if (leg.quote === 'USDT' && usdtRate == null) continue;
      const bar = this.barAt(this.seriesFor(leg, resolutionSec), resolutionSec, timestamp);
      if (!bar) continue;
      bars.push({
        bar: leg.quote === 'USDT' ? scaleBar(bar, usdtRate!) : bar,
        weight: SPOT_VENUES[leg.venue].weight,
      });
      venues.push(leg.venue);
    }
    return { bars, venues };
  }

  /**
   * USDT/USD per bucket. A bucket with no USDT print carries the previous close, and
   * buckets before the first print use the earliest one. No rate at all leaves USDT
   * venues out rather than treating USDT as worth a dollar.
   */
  private ratesFor(
    resolutionSec: SpotCandleResolutionSec,
    startMs: number,
    endMs: number,
  ): (number | null)[] {
    const series = this.seriesFor(USDT_RATE_LEG, resolutionSec);
    const resMs = resolutionSec * 1000;
    const rates: (number | null)[] = [];
    let last = this.latestRateBefore(series, startMs);
    let firstKnown: number | null = null;
    for (let ts = startMs; ts <= endMs; ts += resMs) {
      const bar = this.barAt(series, resolutionSec, ts);
      if (bar) {
        last = usdPerUsdt(bar);
        firstKnown ??= last;
      }
      rates.push(last);
    }
    return rates.map((rate) => rate ?? firstKnown);
  }

  private latestRateBefore(series: SpotSeries, timestamp: number): number | null {
    let bestTs = -1;
    let best: number | null = null;
    for (const bar of series.bars.values()) {
      if (bar.timestamp < timestamp && bar.timestamp > bestTs) {
        bestTs = bar.timestamp;
        best = usdPerUsdt(bar);
      }
    }
    return best;
  }

  private attachStreams(subscription: SpotSubscription): void {
    for (const leg of [...subscription.legs, USDT_RATE_LEG]) {
      const sourceRes = sourceResolution(leg.venue, subscription.resolutionSec);
      const def = SPOT_VENUES[leg.venue];
      if (def.tickStream) {
        const key = `${leg.venue}|${leg.symbol}`;
        const active = this.tickResolutions.get(key) ?? new Map<SpotCandleResolutionSec, number>();
        active.set(sourceRes, (active.get(sourceRes) ?? 0) + 1);
        this.tickResolutions.set(key, active);
      }
      const topic = def.topic(leg.symbol, def.resolutions[sourceRes]!);
      const refKey = `${leg.venue}|${topic}`;
      const refs = this.topicRefs.get(refKey) ?? 0;
      this.topicRefs.set(refKey, refs + 1);
      if (refs === 0) this.transportFor(leg.venue).add([topic]);
    }
  }

  private releaseSubscription(key: string, subscription: SpotSubscription): void {
    subscription.lingerTimer = null;
    if (subscription.listeners.size > 0) return;
    this.subscriptions.delete(key);
    this.dirty.delete(subscription);
    for (const leg of [...subscription.legs, USDT_RATE_LEG]) {
      const sourceRes = sourceResolution(leg.venue, subscription.resolutionSec);
      const def = SPOT_VENUES[leg.venue];
      if (def.tickStream) {
        const tickKey = `${leg.venue}|${leg.symbol}`;
        const active = this.tickResolutions.get(tickKey);
        const remaining = (active?.get(sourceRes) ?? 1) - 1;
        if (remaining > 0) active?.set(sourceRes, remaining);
        else active?.delete(sourceRes);
        if (active?.size === 0) this.tickResolutions.delete(tickKey);
      }
      const topic = def.topic(leg.symbol, def.resolutions[sourceRes]!);
      const refKey = `${leg.venue}|${topic}`;
      const refs = (this.topicRefs.get(refKey) ?? 1) - 1;
      if (refs > 0) {
        this.topicRefs.set(refKey, refs);
      } else {
        this.topicRefs.delete(refKey);
        this.transports.get(leg.venue)?.remove([topic]);
      }
    }
    if (this.subscriptions.size === 0 && this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private transportFor(venue: SpotVenue): SpotStreamTransport {
    let transport = this.transports.get(venue);
    if (!transport) {
      transport = this.createTransport(venue, (events) => this.onStreamEvents(venue, events));
      this.transports.set(venue, transport);
    }
    return transport;
  }

  // Quote-built bars need the forming bucket's real open and earlier volume, and USDT legs need a rate.
  private seedForming(subscription: SpotSubscription): void {
    const { resolutionSec, legs } = subscription;
    const resMs = resolutionSec * 1000;
    const startMs = Math.floor(this.now() / resMs) * resMs - resMs * SEEDED_BUCKETS;
    const loads = [...legs, USDT_RATE_LEG].map((leg) =>
      this.ensureHistory(this.seriesFor(leg, resolutionSec), startMs, resolutionSec),
    );
    void Promise.race([
      Promise.allSettled(loads),
      new Promise<void>((resolve) => setTimeout(resolve, HISTORY_DEADLINE_MS).unref()),
    ]).then(() => {
      subscription.seeded = true;
      this.dirty.add(subscription);
    });
  }

  private onStreamEvents(venue: SpotVenue, events: readonly SpotStreamEvent[]): void {
    for (const event of events) {
      if (event.kind === 'bar') this.applyBar(venue, event);
      else this.applyTickEvent(venue, event);
      for (const subscription of this.subscriptions.values()) {
        const touches =
          (USDT_RATE_LEG.venue === venue && USDT_RATE_LEG.symbol === event.symbol) ||
          subscription.legs.some((leg) => leg.venue === venue && leg.symbol === event.symbol);
        if (touches) this.dirty.add(subscription);
      }
    }
  }

  private applyBar(venue: SpotVenue, event: Extract<SpotStreamEvent, { kind: 'bar' }>): void {
    const series = this.series.get(`${venue}|${event.symbol}|${event.resolutionSec}`);
    // The same stale-price rule as history: a bucket's first frame can repeat the last price with no trades.
    if (series && event.bar.volume > 0) this.setBar(series, event.bar);
  }

  private applyTickEvent(venue: SpotVenue, event: Extract<SpotStreamEvent, { kind: 'tick' }>): void {
    const active = this.tickResolutions.get(`${venue}|${event.symbol}`);
    if (!active) return;
    for (const sourceRes of active.keys()) {
      const series = this.series.get(`${venue}|${event.symbol}|${sourceRes}`);
      if (!series) continue;
      const resMs = sourceRes * 1000;
      const bucket = Math.floor(event.timestamp / resMs) * resMs;
      this.setBar(series, applyTick(series.bars.get(bucket), bucket, event.price, event.size));
    }
  }

  private startFlushing(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
    this.flushTimer.unref();
  }

  private flush(): void {
    if (this.dirty.size === 0) return;
    const pending = [...this.dirty];
    this.dirty.clear();
    for (const subscription of pending) {
      if (!subscription.seeded) continue;
      if (subscription.listeners.size > 0) this.emitTail(subscription);
    }
  }

  // The previous bucket is included so its final values reach clients as it closes.
  private emitTail(subscription: SpotSubscription): void {
    const { resolutionSec, legs, lastSent, listeners, newListeners } = subscription;
    const resMs = resolutionSec * 1000;
    const forming = Math.floor(this.now() / resMs) * resMs;
    const rateSeries = this.seriesFor(USDT_RATE_LEG, resolutionSec);

    for (const ts of [forming - resMs, forming]) {
      const rateBar = this.barAt(rateSeries, resolutionSec, ts);
      const rate = rateBar ? usdPerUsdt(rateBar) : this.latestRateBefore(rateSeries, ts);
      const candle = aggregateBars(ts, this.bucketInputs(legs, resolutionSec, ts, rate).bars);
      if (!candle) continue;
      const serialized = JSON.stringify(candle);
      const changed = lastSent.get(ts) !== serialized;
      lastSent.set(ts, serialized);
      for (const listener of listeners) {
        if (changed || newListeners.has(listener)) listener(candle);
      }
    }
    newListeners.clear();
    for (const ts of lastSent.keys()) {
      if (ts < forming - resMs) lastSent.delete(ts);
    }
  }

  private pruneIdleSeries(): void {
    const cutoff = this.now() - SERIES_IDLE_MS;
    for (const [key, series] of this.series) {
      if (series.lastReadAt < cutoff && !series.loading) this.series.delete(key);
    }
  }
}
