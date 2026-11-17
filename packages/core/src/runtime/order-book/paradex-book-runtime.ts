import { z } from 'zod';

import { ParadexMarketsResponseSchema } from '../../feeds/paradex/types.js';
import {
  PARADEX_REST_BASE_URL,
  PARADEX_TESTNET_REST_BASE_URL,
} from '../../feeds/shared/endpoints.js';
import type { OrderBookSnapshot } from '../../liquidity/types.js';
import { feedLogger } from '../../utils/logger.js';
import { OrderBookCapacityError, type OrderBookLease } from './order-book-runtime.js';

const decimal = z
  .string()
  .regex(/^\d+(?:\.\d+)?$/)
  .transform(Number)
  .pipe(z.number().finite());
const level = z.tuple([
  decimal.pipe(z.number().positive()),
  decimal.pipe(z.number().nonnegative()),
]);
const SnapshotSchema = z.object({
  market: z.string(),
  seq_no: z.number().int().nonnegative(),
  last_updated_at: z.number().int().nonnegative(),
  bids: z.array(level).max(1000),
  asks: z.array(level).max(1000),
});

const log = feedLogger('paradex-exit-books');

export interface ParadexBookRuntimeOptions {
  environment?: 'prod' | 'test';
  fetchImpl?: typeof fetch;
  now?: () => number;
  refreshMs?: number;
  maxInstruments?: number;
}

export class ParadexBookRuntime {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshMs: number;
  private readonly maxInstruments: number;
  private readonly baseUrl: string;
  private readonly refs = new Map<string, number>();
  private readonly books = new Map<string, OrderBookSnapshot>();
  private readonly fees = new Map<string, { rate: number; cap: number }>();
  private readonly rejected = new Set<string>();
  private readonly epochs = new Map<string, number>();
  private nextEpoch = 0;
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private specsAt: number | null = null;
  private disposed = false;

  constructor(options: ParadexBookRuntimeOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.refreshMs = options.refreshMs ?? 5_000;
    this.maxInstruments = options.maxInstruments ?? 40;
    this.baseUrl =
      options.environment === 'test' ? PARADEX_TESTNET_REST_BASE_URL : PARADEX_REST_BASE_URL;
  }

  acquire(instrument: string): OrderBookLease {
    if (this.disposed) throw new Error('Paradex book runtime disposed');
    if (!this.refs.has(instrument) && this.refs.size >= this.maxInstruments) {
      throw new OrderBookCapacityError(this.maxInstruments);
    }
    if (!this.refs.has(instrument)) this.epochs.set(instrument, ++this.nextEpoch);
    this.refs.set(instrument, (this.refs.get(instrument) ?? 0) + 1);
    if (this.timer == null) {
      this.timer = setInterval(() => void this.refresh(), this.refreshMs);
      this.timer.unref?.();
    }
    void this.refresh();
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const count = (this.refs.get(instrument) ?? 1) - 1;
        if (count > 0) this.refs.set(instrument, count);
        else {
          this.refs.delete(instrument);
          this.books.delete(instrument);
          this.rejected.delete(instrument);
          this.epochs.delete(instrument);
        }
        if (this.refs.size === 0 && this.timer != null) {
          clearInterval(this.timer);
          this.timer = null;
        }
      },
    };
  }

  getBook(instrument: string): OrderBookSnapshot | null {
    return this.books.get(instrument) ?? null;
  }

  isRejected(instrument: string): boolean {
    return this.rejected.has(instrument);
  }

  refresh(): Promise<void> {
    if (this.disposed || this.refs.size === 0) return Promise.resolve();
    if (this.inFlight != null) return this.inFlight;
    this.inFlight = this.refreshBooks()
      .catch((error: unknown) => {
        if (!this.disposed) {
          for (const [symbol, book] of this.books)
            this.books.set(symbol, { ...book, state: 'unsynchronized' });
          log.warn({ err: String(error) }, 'paradex book metadata unavailable');
        }
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async read(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5_000)]),
    });
    if (!response.ok) throw new Error(`Paradex public book HTTP ${response.status}`);
    return response.json();
  }

  private async refreshBooks(): Promise<void> {
    if (this.specsAt == null || this.now() - this.specsAt > 3_600_000) {
      const markets = ParadexMarketsResponseSchema.parse(await this.read('/markets'));
      if (this.disposed) return;
      this.fees.clear();
      for (const market of markets.results) {
        if (market.asset_kind !== 'OPTION' || market.quote_currency !== 'USD') continue;
        const fee = market.fee_config?.api_fee?.taker_fee;
        const rate = fee?.fee == null || fee.fee === '' ? NaN : Number(fee.fee);
        const cap = fee?.fee_cap == null || fee.fee_cap === '' ? NaN : Number(fee.fee_cap);
        if (Number.isFinite(rate) && rate >= 0 && Number.isFinite(cap) && cap >= 0) {
          this.fees.set(market.symbol, { rate, cap });
        }
      }
      this.specsAt = this.now();
    }
    const symbols = [...this.refs.keys()];
    for (let offset = 0; offset < symbols.length && !this.disposed; offset += 4) {
      await Promise.all(
        symbols.slice(offset, offset + 4).map((symbol) => this.refreshBook(symbol)),
      );
    }
  }

  private async refreshBook(symbol: string): Promise<void> {
    const epoch = this.epochs.get(symbol);
    if (epoch == null) return;
    try {
      const fee = this.fees.get(symbol);
      if (fee == null) {
        this.rejected.add(symbol);
        const previous = this.books.get(symbol);
        if (previous != null) this.books.set(symbol, { ...previous, state: 'unsynchronized' });
        return;
      }
      const snapshot = SnapshotSchema.parse(
        await this.read(`/orderbook/${encodeURIComponent(symbol)}?depth=100`),
      );
      if (this.disposed || this.epochs.get(symbol) !== epoch) return;
      if (snapshot.market !== symbol) throw new Error('Paradex book market mismatch');
      const bids = snapshot.bids
        .filter(([, size]) => size > 0)
        .map(([price, amount]) => ({ price, amount, outrightAmount: amount }))
        .sort((a, b) => b.price - a.price);
      const asks = snapshot.asks
        .filter(([, size]) => size > 0)
        .map(([price, amount]) => ({ price, amount, outrightAmount: amount }))
        .sort((a, b) => a.price - b.price);
      if (
        new Set(bids.map((l) => l.price)).size !== bids.length ||
        new Set(asks.map((l) => l.price)).size !== asks.length
      )
        throw new Error('Duplicate Paradex book price');
      const crossed = bids[0] != null && asks[0] != null && bids[0].price >= asks[0].price;
      this.books.set(symbol, {
        venue: 'paradex',
        instrument: symbol,
        priceUnit: 'usd',
        quantityUnit: 'base',
        bids,
        asks,
        totalBidAmount: bids.reduce((sum, l) => sum + l.amount, 0),
        totalAskAmount: asks.reduce((sum, l) => sum + l.amount, 0),
        exchangeTs: snapshot.last_updated_at,
        receivedAt: this.now(),
        generation: epoch,
        state: 'synced',
        crossed,
        mark: null,
        takerFee: fee,
      });
      this.rejected.delete(symbol);
    } catch (error) {
      if (this.disposed || this.epochs.get(symbol) !== epoch) return;
      const previous = this.books.get(symbol);
      if (previous != null) this.books.set(symbol, { ...previous, state: 'unsynchronized' });
      log.warn({ err: String(error), symbol }, 'paradex depth snapshot unavailable');
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer != null) clearInterval(this.timer);
    this.abort.abort();
    await this.inFlight;
    this.refs.clear();
    this.books.clear();
    this.fees.clear();
    this.rejected.clear();
    this.epochs.clear();
  }
}
