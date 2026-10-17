import {
  VOL_HEATMAP_BUCKET,
  type VolHeatmapCell,
  type VolHeatmapColumn,
  type VolHeatmapTrade,
} from '@oggregator/protocol';
import { solveIv, vega76, yearsToExpiry } from '../../feeds/thalex/bs-solver.js';
import type { HeatmapInstrument } from './select.js';

type Level = readonly [price: number, amount: number];

export interface HeatmapTradeInput {
  t: number;
  instrument: string;
  side: 'buy' | 'sell';
  /** Premium in the base currency. */
  price: number;
  amount: number;
  /** Fraction, when the venue reports it. */
  iv: number | null;
}

const MIN_IV = 0.05;
const MAX_IV = 3;
const MIN_CELL_VEGA = 1;

/**
 * Turns option order books into resting vega per IV bucket. Every level's premium is inverted to
 * an IV against the expiry's forward and weighted by `amount × vega` (USD per vol point).
 * `sample()` snapshots the books into running sums; `flush()` averages those samples into one
 * time-weighted column, the same way a price heatmap averages resting size.
 */
export class VolHeatmapEngine {
  private readonly instruments = new Map<string, HeatmapInstrument>();
  private readonly books = new Map<string, { bids: readonly Level[]; asks: readonly Level[] }>();
  private readonly forwards = new Map<number, number>();
  private readonly seeds = new Map<string, number>();
  private bidSums = new Map<number, number>();
  private askSums = new Map<number, number>();
  private samples = 0;
  private trades: VolHeatmapTrade[] = [];
  private dvol: number | null = null;

  constructor(private readonly bucketSize: number = VOL_HEATMAP_BUCKET) {}

  setInstruments(list: readonly HeatmapInstrument[]): void {
    this.instruments.clear();
    for (const inst of list) this.instruments.set(inst.name, inst);
    for (const name of [...this.books.keys()]) {
      if (!this.instruments.has(name)) this.books.delete(name);
    }
    for (const name of [...this.seeds.keys()]) {
      if (!this.instruments.has(name)) this.seeds.delete(name);
    }
  }

  get instrumentCount(): number {
    return this.instruments.size;
  }

  hasInstrument(name: string): boolean {
    return this.instruments.has(name);
  }

  applyBook(name: string, bids: readonly Level[], asks: readonly Level[]): void {
    if (!this.instruments.has(name)) return;
    this.books.set(name, { bids, asks });
  }

  applyForward(expiry: number, forward: number): void {
    if (forward > 0) this.forwards.set(expiry, forward);
  }

  applyDvol(value: number): void {
    this.dvol = value;
  }

  get currentDvol(): number | null {
    return this.dvol;
  }

  /** Books are only valid while the socket is up; a reconnect resubscribes and refills them. */
  clearBooks(): void {
    this.books.clear();
  }

  addTrade(trade: HeatmapTradeInput): void {
    const inst = this.instruments.get(trade.instrument);
    if (inst == null) return;
    const forward = this.forwards.get(inst.expiry);
    const tYears = yearsToExpiry(inst.expiry, trade.t);
    if (forward == null || tYears == null) return;

    const iv =
      trade.iv ??
      solveIv({
        price: trade.price * forward,
        forward,
        strike: inst.strike,
        tYears,
        right: inst.right,
        seed: this.seeds.get(inst.name) ?? null,
      });
    if (iv == null || iv < MIN_IV || iv > MAX_IV) return;

    this.trades.push({
      t: trade.t,
      instrument: trade.instrument,
      side: trade.side,
      iv,
      amount: trade.amount,
      vega: round2((trade.amount * vega76(forward, inst.strike, iv, tYears)) / 100),
    });
  }

  sample(now: number): void {
    for (const [name, book] of this.books) {
      const inst = this.instruments.get(name);
      if (inst == null) continue;
      const forward = this.forwards.get(inst.expiry);
      const tYears = yearsToExpiry(inst.expiry, now);
      if (forward == null || tYears == null) continue;
      const bestBidIv = this.accumulate(book.bids, inst, forward, tYears, this.bidSums);
      const bestAskIv = this.accumulate(book.asks, inst, forward, tYears, this.askSums);
      const seed = bestBidIv ?? bestAskIv;
      if (seed != null) this.seeds.set(name, seed);
    }
    this.samples++;
  }

  /** Emits the column for `t` and resets the accumulators. DVOL carries over between columns. */
  flush(t: number): VolHeatmapColumn {
    const buckets = new Set<number>([...this.bidSums.keys(), ...this.askSums.keys()]);
    const n = Math.max(this.samples, 1);
    const cells: VolHeatmapCell[] = [];
    for (const bucket of [...buckets].sort((a, b) => a - b)) {
      const bid = Math.round((this.bidSums.get(bucket) ?? 0) / n);
      const ask = Math.round((this.askSums.get(bucket) ?? 0) / n);
      if (bid < MIN_CELL_VEGA && ask < MIN_CELL_VEGA) continue;
      cells.push([bucket, bid, ask]);
    }

    const column: VolHeatmapColumn = { t, dvol: this.dvol, cells, trades: this.trades };
    this.bidSums = new Map();
    this.askSums = new Map();
    this.samples = 0;
    this.trades = [];
    return column;
  }

  /** Returns the IV of the first level that inverted, used to seed the next sample's solve. */
  private accumulate(
    levels: readonly Level[],
    inst: HeatmapInstrument,
    forward: number,
    tYears: number,
    sums: Map<number, number>,
  ): number | null {
    let seed = this.seeds.get(inst.name) ?? null;
    let first: number | null = null;
    for (const [price, amount] of levels) {
      const iv = solveIv({
        price: price * forward,
        forward,
        strike: inst.strike,
        tYears,
        right: inst.right,
        seed,
      });
      if (iv == null || iv < MIN_IV || iv > MAX_IV) continue;
      seed = iv;
      first ??= iv;
      const bucket = Math.round(iv / this.bucketSize);
      const vega = (amount * vega76(forward, inst.strike, iv, tYears)) / 100;
      sums.set(bucket, (sums.get(bucket) ?? 0) + vega);
    }
    return first;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
