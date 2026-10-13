import { z } from 'zod';
import { BYBIT_REST_BASE_URL, BYBIT_TICKERS } from '../../feeds/shared/endpoints.js';
import { feedLogger } from '../../utils/logger.js';

const log = feedLogger('perp-tickers');
const DEFAULT_MAX_AGE_MS = 10_000;

export interface PerpTicker {
  symbol: string;
  lastPrice: number;
  change24hPct: number;
}

export interface PerpTickerSnapshot {
  fetchedAt: number;
  tickers: ReadonlyMap<string, PerpTicker>;
}

export interface PerpTickerRuntimeOptions {
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const BybitLinearTickersSchema = z.object({
  retCode: z.number(),
  retMsg: z.string().optional(),
  result: z.object({
    list: z.array(
      z.object({
        symbol: z.string(),
        lastPrice: z.string(),
        price24hPcnt: z.string(),
      }),
    ),
  }),
});

/**
 * Every Bybit USDT perp (crypto, stocks, ETFs, commodities) from one request, fetched on
 * demand and cached for `maxAgeMs`, so nothing polls while no one is reading.
 */
export class PerpTickerRuntime {
  private readonly fetchImpl: typeof fetch;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private snapshot: PerpTickerSnapshot | null = null;
  private inflight: Promise<PerpTickerSnapshot> | null = null;

  constructor(options: PerpTickerRuntimeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
  }

  /** Returns the cached snapshot when fresh; on a failed refresh, the last good one (or throws if none). */
  async getSnapshot(): Promise<PerpTickerSnapshot> {
    if (this.snapshot && this.now() - this.snapshot.fetchedAt < this.maxAgeMs) return this.snapshot;
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<PerpTickerSnapshot> {
    try {
      const response = await this.fetchImpl(
        `${BYBIT_REST_BASE_URL}${BYBIT_TICKERS}?category=linear`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = BybitLinearTickersSchema.parse(await response.json());
      if (parsed.retCode !== 0) throw new Error(`retCode ${parsed.retCode} ${parsed.retMsg ?? ''}`);

      const tickers = new Map<string, PerpTicker>();
      for (const item of parsed.result.list) {
        const lastPrice = Number(item.lastPrice);
        const change24hPct = Number(item.price24hPcnt);
        if (!(lastPrice > 0) || !Number.isFinite(change24hPct)) continue;
        tickers.set(item.symbol, { symbol: item.symbol, lastPrice, change24hPct });
      }
      this.snapshot = { fetchedAt: this.now(), tickers };
      return this.snapshot;
    } catch (error: unknown) {
      log.warn({ err: String(error) }, 'perp tickers fetch failed');
      if (this.snapshot) return this.snapshot;
      throw error;
    }
  }
}
