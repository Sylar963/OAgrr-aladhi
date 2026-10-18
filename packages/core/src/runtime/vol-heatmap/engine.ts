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

interface SolvedLevel {
  iv: number;
  vega: number;
}

interface SolvedBook {
  bids: SolvedLevel[];
  asks: SolvedLevel[];
  mid: number | null;
}

class BucketSums {
  bid = new Map<number, number>();
  ask = new Map<number, number>();

  add(side: 'bid' | 'ask', bucket: number, vega: number): void {
    const map = this[side];
    map.set(bucket, (map.get(bucket) ?? 0) + vega);
  }

  /** Per-sample averages, dropping buckets under `minVega` on both sides. */
  cells(samples: number, minVega: number): VolHeatmapCell[] {
    const buckets = new Set<number>([...this.bid.keys(), ...this.ask.keys()]);
    const cells: VolHeatmapCell[] = [];
    for (const bucket of [...buckets].sort((a, b) => a - b)) {
      const bid = Math.round((this.bid.get(bucket) ?? 0) / samples);
      const ask = Math.round((this.ask.get(bucket) ?? 0) / samples);
      if (bid < minVega && ask < minVega) continue;
      cells.push([bucket, bid, ask]);
    }
    return cells;
  }
}

const MIN_IV = 0.05;
const MAX_IV = 3;
const MIN_CELL_VEGA = 1;
const ANCHOR_TENOR_YEARS = 30 / 365;

/**
 * Turns option order books into resting vega per IV bucket. Every level's premium is inverted to
 * an IV against the expiry's forward and weighted by `amount × vega` (USD per vol point).
 * `sample()` snapshots the books into running sums; `flush()` averages those samples into one
 * time-weighted column, the same way a price heatmap averages resting size.
 *
 * A second, skew-adjusted set of sums places each level at `iv − mid(option) + atmMid`, where
 * `atmMid` is the ATM options' mid IVs interpolated to 30 days in total variance.
 */
export class VolHeatmapEngine {
  private readonly instruments = new Map<string, HeatmapInstrument>();
  private atmByExpiry: ReadonlyMap<number, string> = new Map();
  private readonly books = new Map<string, { bids: readonly Level[]; asks: readonly Level[] }>();
  private readonly forwards = new Map<number, number>();
  private readonly seeds = new Map<string, number>();
  private mids = new Map<string, number>();
  private anchor: number | null = null;
  private raw = new BucketSums();
  private adjusted = new BucketSums();
  private samples = 0;
  private anchorSum = 0;
  private anchorSamples = 0;
  private trades: VolHeatmapTrade[] = [];
  private dvol: number | null = null;

  constructor(private readonly bucketSize: number = VOL_HEATMAP_BUCKET) {}

  /** `atmByExpiry` names the at-the-money option per expiry that anchors the skew adjustment. */
  setInstruments(list: readonly HeatmapInstrument[], atmByExpiry: ReadonlyMap<number, string> = new Map()): void {
    this.instruments.clear();
    for (const inst of list) this.instruments.set(inst.name, inst);
    this.atmByExpiry = atmByExpiry;
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

    const mid = this.mids.get(inst.name);
    this.trades.push({
      t: trade.t,
      instrument: trade.instrument,
      side: trade.side,
      iv,
      adjIv: mid != null && this.anchor != null ? iv - mid + this.anchor : null,
      amount: trade.amount,
      vega: round2((trade.amount * vega76(forward, inst.strike, iv, tYears)) / 100),
    });
  }

  sample(now: number): void {
    const solved = new Map<string, SolvedBook>();
    for (const [name, book] of this.books) {
      const inst = this.instruments.get(name);
      if (inst == null) continue;
      const forward = this.forwards.get(inst.expiry);
      const tYears = yearsToExpiry(inst.expiry, now);
      if (forward == null || tYears == null) continue;

      const bids = this.solve(book.bids, inst, forward, tYears);
      const asks = this.solve(book.asks, inst, forward, tYears);
      const bestBid = bids[0]?.iv;
      const bestAsk = asks[0]?.iv;
      const seed = bestBid ?? bestAsk;
      if (seed != null) this.seeds.set(name, seed);
      solved.set(name, {
        bids,
        asks,
        mid: bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null,
      });
      for (const level of bids) this.raw.add('bid', this.bucket(level.iv), level.vega);
      for (const level of asks) this.raw.add('ask', this.bucket(level.iv), level.vega);
    }

    this.mids = new Map();
    for (const [name, book] of solved) if (book.mid != null) this.mids.set(name, book.mid);
    this.anchor = this.atmAnchor(now);

    if (this.anchor != null) {
      const anchor = this.anchor;
      for (const book of solved.values()) {
        const mid = book.mid;
        if (mid == null) continue;
        for (const level of book.bids) this.adjusted.add('bid', this.bucket(level.iv - mid + anchor), level.vega);
        for (const level of book.asks) this.adjusted.add('ask', this.bucket(level.iv - mid + anchor), level.vega);
      }
      this.anchorSum += anchor;
      this.anchorSamples++;
    }
    this.samples++;
  }

  /** Emits the column for `t` and resets the accumulators. DVOL carries over between columns. */
  flush(t: number): VolHeatmapColumn {
    const n = Math.max(this.samples, 1);
    const column: VolHeatmapColumn = {
      t,
      dvol: this.dvol,
      cells: this.raw.cells(n, MIN_CELL_VEGA),
      adjCells: this.adjusted.cells(n, MIN_CELL_VEGA),
      atmMid: this.anchorSamples > 0 ? this.anchorSum / this.anchorSamples : null,
      trades: this.trades,
    };
    this.raw = new BucketSums();
    this.adjusted = new BucketSums();
    this.samples = 0;
    this.anchorSum = 0;
    this.anchorSamples = 0;
    this.trades = [];
    return column;
  }

  /** ATM mid IVs interpolated (or extrapolated) to 30 days in total variance. */
  private atmAnchor(now: number): number | null {
    const points: Array<{ t: number; iv: number }> = [];
    for (const [expiry, name] of this.atmByExpiry) {
      const mid = this.mids.get(name);
      const t = yearsToExpiry(expiry, now);
      if (mid != null && t != null) points.push({ t, iv: mid });
    }
    points.sort((a, b) => a.t - b.t);
    const [near, far] = points;
    if (near == null) return null;
    if (far == null) return near.iv;
    const wNear = near.iv * near.iv * near.t;
    const wFar = far.iv * far.iv * far.t;
    const w = wNear + ((wFar - wNear) * (ANCHOR_TENOR_YEARS - near.t)) / (far.t - near.t);
    return w > 0 ? Math.sqrt(w / ANCHOR_TENOR_YEARS) : near.iv;
  }

  private bucket(iv: number): number {
    return Math.round(iv / this.bucketSize);
  }

  private solve(levels: readonly Level[], inst: HeatmapInstrument, forward: number, tYears: number): SolvedLevel[] {
    let seed = this.seeds.get(inst.name) ?? null;
    const out: SolvedLevel[] = [];
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
      out.push({ iv, vega: (amount * vega76(forward, inst.strike, iv, tYears)) / 100 });
    }
    return out;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
