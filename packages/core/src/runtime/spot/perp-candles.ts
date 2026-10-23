import { z } from 'zod';
import { BYBIT_KLINE, BYBIT_REST_BASE_URL } from '../../feeds/shared/endpoints.js';
import { feedLogger } from '../../utils/logger.js';

const log = feedLogger('perp-candles');

const BAR_MS = 300_000;
const BYBIT_MAX_LIMIT = 1_000;
const BYBIT_INVALID_SYMBOL = 10_001;
const DEFAULT_CONCURRENCY = 8;
// Bybit publishes a bar's final close a moment after the boundary.
const DEFAULT_CLOSE_GRACE_MS = 3_000;
const FAILED_RETRY_MS = 30_000;
const INVALID_RETRY_MS = 3_600_000;

export interface PerpCandle {
  start: number;
  close: number;
  volume: number;
}

export interface PerpCandleSnapshot {
  barMs: number;
  /** Start of the newest closed bar; series never include the bar still forming. */
  lastClosedStart: number;
  /** Closed bars ascending by start. Symbols Bybit does not list, or never loaded, are absent. */
  series: ReadonlyMap<string, readonly PerpCandle[]>;
}

export interface PerpCandleRuntimeOptions {
  /** Bars kept per symbol; the first load fetches this many (capped at Bybit's 1000). */
  historyBars?: number;
  concurrency?: number;
  closeGraceMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

// Rows are [start, open, high, low, close, volume, turnover], newest first.
const BybitKlineSchema = z.object({
  retCode: z.number(),
  retMsg: z.string().optional(),
  result: z.object({ list: z.array(z.array(z.string()).min(6)).optional() }),
});

class InvalidSymbolError extends Error {}

/**
 * 5m Bybit linear-perp closes for an arbitrary symbol set, fetched on demand: the first read
 * loads `historyBars`, later reads after a bar closes fetch only the missing tail. Nothing polls
 * while no one is reading; a gap after idle is backfilled on the next read.
 */
export class PerpCandleRuntime {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly historyBars: number;
  private readonly concurrency: number;
  private readonly closeGraceMs: number;
  private readonly series = new Map<string, readonly PerpCandle[]>();
  private readonly retryAt = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(options: PerpCandleRuntimeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.historyBars = options.historyBars ?? BYBIT_MAX_LIMIT;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.closeGraceMs = options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS;
  }

  lastClosedStart(): number {
    return Math.floor((this.now() - this.closeGraceMs) / BAR_MS) * BAR_MS - BAR_MS;
  }

  async getCandles(symbols: readonly string[]): Promise<PerpCandleSnapshot> {
    const lastClosedStart = this.lastClosedStart();
    const unique = [...new Set(symbols)];
    const stale = unique.filter((s) => this.needsRefresh(s, lastClosedStart));

    let next = 0;
    const worker = async () => {
      while (next < stale.length) await this.refreshOnce(stale[next++]!, lastClosedStart);
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, stale.length) }, worker));

    const series = new Map<string, readonly PerpCandle[]>();
    for (const symbol of unique) {
      const bars = this.series.get(symbol);
      if (bars && bars.length > 0) series.set(symbol, bars);
    }
    return { barMs: BAR_MS, lastClosedStart, series };
  }

  private needsRefresh(symbol: string, lastClosedStart: number): boolean {
    if ((this.retryAt.get(symbol) ?? 0) > this.now()) return false;
    const bars = this.series.get(symbol);
    return !bars || bars.length === 0 || bars[bars.length - 1]!.start < lastClosedStart;
  }

  private refreshOnce(symbol: string, lastClosedStart: number): Promise<void> {
    let pending = this.inflight.get(symbol);
    if (!pending) {
      pending = this.refresh(symbol, lastClosedStart).finally(() => this.inflight.delete(symbol));
      this.inflight.set(symbol, pending);
    }
    return pending;
  }

  private async refresh(symbol: string, lastClosedStart: number): Promise<void> {
    const existing = this.series.get(symbol) ?? [];
    const last = existing[existing.length - 1];
    const missing = last ? (lastClosedStart - last.start) / BAR_MS : this.historyBars;
    // +2 covers the forming bar Bybit includes and one bar of overlap with what we hold.
    const limit = Math.min(BYBIT_MAX_LIMIT, this.historyBars, missing + 2);

    try {
      const fetched = await this.fetchBars(symbol, limit, lastClosedStart);
      const firstFetched = fetched[0]?.start ?? Number.POSITIVE_INFINITY;
      const merged = [...existing.filter((b) => b.start < firstFetched), ...fetched];
      this.series.set(symbol, merged.slice(-this.historyBars));
      this.retryAt.delete(symbol);
    } catch (error: unknown) {
      const invalid = error instanceof InvalidSymbolError;
      this.retryAt.set(symbol, this.now() + (invalid ? INVALID_RETRY_MS : FAILED_RETRY_MS));
      log.warn({ symbol, err: String(error) }, 'perp candles fetch failed');
    }
  }

  private async fetchBars(
    symbol: string,
    limit: number,
    lastClosedStart: number,
  ): Promise<PerpCandle[]> {
    const url = `${BYBIT_REST_BASE_URL}${BYBIT_KLINE}?category=linear&symbol=${encodeURIComponent(symbol)}&interval=5&limit=${limit}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = BybitKlineSchema.parse(await response.json());
    if (parsed.retCode === BYBIT_INVALID_SYMBOL) throw new InvalidSymbolError(parsed.retMsg);
    if (parsed.retCode !== 0) throw new Error(`retCode ${parsed.retCode} ${parsed.retMsg ?? ''}`);

    const bars: PerpCandle[] = [];
    for (const row of parsed.result.list ?? []) {
      const start = Number(row[0]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      if (start > lastClosedStart || !(close > 0) || !Number.isFinite(volume)) continue;
      bars.push({ start, close, volume });
    }
    return bars.sort((a, b) => a.start - b.start);
  }
}
