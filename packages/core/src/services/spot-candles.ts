import { z } from 'zod';
import { DERIBIT_REST_BASE_URL } from '../feeds/shared/endpoints.js';
import { feedLogger } from '../utils/logger.js';

const log = feedLogger('spot-candles');

export type SpotCandleCurrency = 'BTC' | 'ETH';
export type SpotCandleResolutionSec = 60 | 300 | 900 | 1800 | 3600 | 14400 | 86400;

export interface SpotCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const ChartDataSchema = z.object({
  status: z.string(),
  ticks: z.array(z.number()),
  open: z.array(z.number()),
  high: z.array(z.number()),
  low: z.array(z.number()),
  close: z.array(z.number()),
});

const ResponseSchema = z.object({
  result: ChartDataSchema,
});

const RESOLUTION_TO_DERIBIT: Record<SpotCandleResolutionSec, string> = {
  60: '1',
  300: '5',
  900: '15',
  1800: '30',
  3600: '60',
  // Deribit has no native 4h ('240' is rejected with HTTP 400). The 4h tier is
  // served by fetching 1h bars and downsampling — fetchFromDeribit remaps 14400
  // to its source resolution, so this entry is never requested directly.
  14400: '60',
  86400: '1D',
};

// 4h is fetched as 1h and downsampled to UTC-4h-grid buckets so the bars line
// up with other venues' 4h candles (the trade-attribution view matches option
// marks to these by exact timestamp).
const AGGREGATE_4H_SEC: SpotCandleResolutionSec = 14400;
const AGGREGATE_4H_SOURCE_SEC: SpotCandleResolutionSec = 3600;
const FOUR_HOUR_MS = AGGREGATE_4H_SEC * 1000;

interface CacheEntry {
  fetchedAt: number;
  candles: SpotCandle[];
}

export function spotCandleCacheTtlMs(resolutionSec: SpotCandleResolutionSec): number {
  if (resolutionSec <= 300) return 15_000;
  if (resolutionSec <= 1800) return 30_000;
  if (resolutionSec <= 3600) return 60_000;
  if (resolutionSec <= 14400) return 120_000;
  return 300_000;
}

/**
 * Downsample ascending candles into fixed-width buckets aligned to the epoch
 * grid (bucketMs). Used to build 4h bars from Deribit 1h bars: open is the
 * first bar in a bucket, close the last, high/low the extremes; the bucket
 * timestamp is its grid-aligned start so it matches other venues' bars.
 */
export function downsampleCandles(candles: SpotCandle[], bucketMs: number): SpotCandle[] {
  const byBucket = new Map<number, SpotCandle>();
  // Sort ascending so open=first / close=last hold regardless of input order.
  for (const c of [...candles].sort((a, b) => a.timestamp - b.timestamp)) {
    const bucketTs = Math.floor(c.timestamp / bucketMs) * bucketMs;
    const bar = byBucket.get(bucketTs);
    if (bar) {
      bar.high = Math.max(bar.high, c.high);
      bar.low = Math.min(bar.low, c.low);
      bar.close = c.close;
    } else {
      byBucket.set(bucketTs, {
        timestamp: bucketTs,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      });
    }
  }
  return [...byBucket.values()];
}

/**
 * On-demand fetcher for Deribit perpetual klines used as a spot proxy for
 * BTC/ETH on the Builder V2 chart. The frontend layers live chain spot updates
 * onto these historical bars, so this service only needs to keep the history
 * window reasonably fresh per resolution tier. Deribit only lists BTC/ETH
 * perps — SOL is unsupported here and the caller must handle it as an empty
 * result.
 */
export class SpotCandleService {
  private readonly cache = new Map<string, CacheEntry>();
  private ready = false;

  async start(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    this.ready = false;
    this.cache.clear();
  }

  async getCandles(
    currency: SpotCandleCurrency,
    resolutionSec: SpotCandleResolutionSec,
    buckets: number,
  ): Promise<SpotCandle[]> {
    const ttlMs = spotCandleCacheTtlMs(resolutionSec);
    const key = `${currency}|${resolutionSec}|${buckets}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < ttlMs) {
      return cached.candles;
    }

    try {
      const candles = await this.fetchFromDeribit(currency, resolutionSec, buckets);
      // Don't cache empty results: a transient Deribit error or schema drift
      // would otherwise lock every requester into "no data" for the full TTL.
      if (candles.length > 0) {
        this.cache.set(key, { fetchedAt: Date.now(), candles });
      }
      return candles;
    } catch (err) {
      // Upstream blew up. If we've ever served this key successfully, keep
      // serving the last good payload past TTL rather than 502'ing the
      // client — slightly stale history is far better UX than dropping the
      // chart during transient Deribit hiccups.
      if (cached) {
        log.warn(
          {
            currency,
            resolutionSec,
            buckets,
            ageMs: Date.now() - cached.fetchedAt,
            err: String(err),
          },
          'serving stale candles after upstream failure',
        );
        return cached.candles;
      }
      throw err;
    }
  }

  private async fetchFromDeribit(
    currency: SpotCandleCurrency,
    resolutionSec: SpotCandleResolutionSec,
    buckets: number,
  ): Promise<SpotCandle[]> {
    // Deribit has no 4h resolution; fetch the 4h tier as 1h over the same
    // window and downsample below.
    const aggregate4h = resolutionSec === AGGREGATE_4H_SEC;
    const fetchResolutionSec = aggregate4h ? AGGREGATE_4H_SOURCE_SEC : resolutionSec;

    const end = Date.now();
    const start = end - resolutionSec * 1000 * buckets;
    const instrument = `${currency}-PERPETUAL`;
    const params = new URLSearchParams({
      instrument_name: instrument,
      start_timestamp: String(start),
      end_timestamp: String(end),
      resolution: RESOLUTION_TO_DERIBIT[fetchResolutionSec],
    });

    const url = `${DERIBIT_REST_BASE_URL}/api/v2/public/get_tradingview_chart_data?${params}`;
    const res = await this.fetchDeribitWithRetry(url, currency, resolutionSec);

    const json: unknown = await res.json();
    const parsed = ResponseSchema.safeParse(json);
    if (!parsed.success) {
      log.warn({ currency, resolutionSec, issue: parsed.error.message }, 'klines parse failed');
      return [];
    }

    const { ticks, open, high, low, close } = parsed.data.result;
    const len = Math.min(ticks.length, open.length, high.length, low.length, close.length);
    const candles: SpotCandle[] = [];
    for (let i = 0; i < len; i++) {
      candles.push({
        timestamp: ticks[i]!,
        open: open[i]!,
        high: high[i]!,
        low: low[i]!,
        close: close[i]!,
      });
    }
    return aggregate4h ? downsampleCandles(candles, FOUR_HOUR_MS) : candles;
  }

  /**
   * Bounded retry around the Deribit fetch so a transient blip (timeout,
   * network error, 5xx, or 429) doesn't reach the route as a 502 when the
   * cache is cold. Per-attempt timeout is short (4s vs the old single-shot
   * 10s) to keep the total bounded — ~12.75s worst case across 3 attempts.
   * A deterministic 4xx (except 429) fails fast rather than burning the budget.
   */
  private async fetchDeribitWithRetry(
    url: string,
    currency: SpotCandleCurrency,
    resolutionSec: SpotCandleResolutionSec,
  ): Promise<Response> {
    const backoffsMs = [250, 500]; // gaps after attempts 1 and 2 → 3 attempts total
    let lastErr: unknown;

    for (let attempt = 0; attempt < backoffsMs.length + 1; attempt++) {
      let res: Response | null = null;
      try {
        res = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(4_000),
        });
      } catch (err) {
        // AbortError (timeout) and network errors are retryable.
        lastErr = err;
      }

      if (res) {
        if (res.ok) return res;
        if (res.status < 500 && res.status !== 429) {
          throw new Error(`Deribit klines ${res.status}`);
        }
        lastErr = new Error(`Deribit klines ${res.status}`);
      }

      if (attempt < backoffsMs.length) {
        const delay = backoffsMs[attempt]! + Math.random() * 100; // jitter
        log.warn(
          { currency, resolutionSec, attempt: attempt + 1, err: String(lastErr) },
          'deribit klines attempt failed, retrying',
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw lastErr;
  }
}
