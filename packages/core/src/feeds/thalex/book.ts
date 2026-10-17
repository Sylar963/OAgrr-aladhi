import type { BookLevel, BookSyncState, OrderBookSnapshot } from '../../liquidity/types.js';
import type { ThalexBook, ThalexTicker } from './types.js';

export const THALEX_BOOK_DELAY = '100ms';
export const THALEX_BOOK_TICKER_DELAY = '1000ms';
export const THALEX_DEFAULT_BOOK_DEPTH = 25;

const OUTRIGHT = String.raw`(?:BTC|ETH)-(?:PERPETUAL|\d{2}[A-Z]{3}\d{2}(?:-\d+(?:\.\d+)?-[CP])?)`;
const OUTRIGHT_RE = new RegExp(`^${OUTRIGHT}$`);
const COMBO_LEG = String.raw`${OUTRIGHT}:-?\d+(?:\.\d+)?`;
const COMBO_RE = new RegExp(`^\\[${COMBO_LEG}(?:,${COMBO_LEG}){1,3}\\]$`);

/** Outright (`BTC-PERPETUAL`, `BTC-25DEC26`, `BTC-25DEC26-100000-C`) or a 2-4 leg combo. */
export function isThalexBookInstrument(name: string): boolean {
  return OUTRIGHT_RE.test(name) || COMBO_RE.test(name);
}

export function thalexBookChannel(instrument: string, depth: number): string {
  return `book.${instrument}.none.${depth}.${THALEX_BOOK_DELAY}`;
}

export function thalexBookTickerChannel(instrument: string): string {
  return `ticker.${instrument}.${THALEX_BOOK_TICKER_DELAY}`;
}

/** `book.<instrument>.none.<n>.<delay>` → instrument. Instrument names contain no dots. */
export function instrumentFromBookChannel(channel: string): string | null {
  if (!channel.startsWith('book.')) return null;
  const parts = channel.slice('book.'.length).split('.');
  return parts.length === 4 ? parts[0]! : null;
}

export function instrumentFromTickerChannel(channel: string): string | null {
  if (!channel.startsWith('ticker.')) return null;
  const parts = channel.slice('ticker.'.length).split('.');
  return parts.length === 2 ? parts[0]! : null;
}

export type BookApplyResult = 'applied' | 'ignored' | 'invalid';

function validLevel(raw: number[]): raw is [number, number, ...number[]] {
  const [price, amount, outright] = raw;
  return (
    price !== undefined &&
    amount !== undefined &&
    Number.isFinite(price) &&
    price > 0 &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    (outright === undefined || (Number.isFinite(outright) && outright >= 0))
  );
}

/**
 * One Thalex book, rebuilt from a snapshot plus changes. Pure: no I/O, no timers. The caller
 * resubscribes when `apply` returns `invalid` or the connection drops.
 */
export class ThalexBookState {
  private readonly bids = new Map<number, BookLevel>();
  private readonly asks = new Map<number, BookLevel>();
  private state: BookSyncState = 'uninitialized';
  private generation = 0;
  private totalBidAmount: number | null = null;
  private totalAskAmount: number | null = null;
  private exchangeTs: number | null = null;
  private receivedAt = 0;
  private mark: OrderBookSnapshot['mark'] = null;

  constructor(
    readonly instrument: string,
    private readonly depth: number = THALEX_DEFAULT_BOOK_DEPTH,
  ) {}

  get syncState(): BookSyncState {
    return this.state;
  }

  apply(book: ThalexBook, snapshot: boolean, receivedAt: number, generation: number): BookApplyResult {
    if (!snapshot && this.state !== 'synced') return 'ignored';
    const changes = [...(book.bid_changes ?? []), ...(book.ask_changes ?? [])];
    if (!changes.every(validLevel)) {
      this.markUnsynchronized(generation);
      return 'invalid';
    }
    if (snapshot) {
      this.bids.clear();
      this.asks.clear();
      this.generation = generation;
    }
    applyChanges(this.bids, book.bid_changes ?? []);
    applyChanges(this.asks, book.ask_changes ?? []);
    trim(this.bids, this.depth, 'desc');
    trim(this.asks, this.depth, 'asc');
    this.state = 'synced';
    if (book.total_bid_amount != null) this.totalBidAmount = book.total_bid_amount;
    if (book.total_ask_amount != null) this.totalAskAmount = book.total_ask_amount;
    this.exchangeTs = book.time != null && book.time > 0 ? Math.round(book.time * 1000) : null;
    this.receivedAt = receivedAt;
    return 'applied';
  }

  applyTicker(ticker: ThalexTicker, receivedAt: number): void {
    if (ticker.mark_price == null) return;
    this.mark = {
      markPrice: ticker.mark_price,
      indexPrice: ticker.index ?? null,
      delta: ticker.delta ?? null,
      iv: ticker.iv ?? null,
      collarLow: ticker.collar_low ?? null,
      collarHigh: ticker.collar_high ?? null,
      receivedAt,
    };
  }

  /** Levels are dropped, not kept stale: an estimate from an unsynced book would be fiction. */
  markUnsynchronized(generation: number): void {
    this.bids.clear();
    this.asks.clear();
    this.totalBidAmount = null;
    this.totalAskAmount = null;
    this.generation = generation;
    if (this.state !== 'uninitialized') this.state = 'unsynchronized';
  }

  toSnapshot(): OrderBookSnapshot {
    const bids = [...this.bids.values()].sort((a, b) => b.price - a.price);
    const asks = [...this.asks.values()].sort((a, b) => a.price - b.price);
    const bestBid = bids[0]?.price;
    const bestAsk = asks[0]?.price;
    return {
      venue: 'thalex',
      instrument: this.instrument,
      priceUnit: 'usd',
      quantityUnit: 'base',
      bids,
      asks,
      totalBidAmount: this.totalBidAmount,
      totalAskAmount: this.totalAskAmount,
      exchangeTs: this.exchangeTs,
      receivedAt: this.receivedAt,
      generation: this.generation,
      state: this.state,
      crossed: bestBid !== undefined && bestAsk !== undefined && bestBid >= bestAsk,
      mark: this.mark,
    };
  }
}

function applyChanges(side: Map<number, BookLevel>, changes: number[][]): void {
  for (const [price, amount, outright] of changes as Array<[number, number, number?]>) {
    if (amount === 0) {
      side.delete(price);
    } else {
      side.set(price, { price, amount, outrightAmount: outright ?? amount });
    }
  }
}

function trim(side: Map<number, BookLevel>, depth: number, order: 'asc' | 'desc'): void {
  if (side.size <= depth) return;
  const prices = [...side.keys()].sort((a, b) => (order === 'asc' ? a - b : b - a));
  for (const price of prices.slice(depth)) side.delete(price);
}
