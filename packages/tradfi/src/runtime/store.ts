import type { TradfiInstrument } from '../tastytrade/instrument.js';

export interface TradfiLiveQuote {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  last: number | null;
  mark: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  openInterest: number | null;
  volume: number | null;
  ts: number;
}

export function emptyQuote(): TradfiLiveQuote {
  return {
    bid: null, ask: null, bidSize: null, askSize: null, last: null, mark: null,
    iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
    openInterest: null, volume: null, ts: 0,
  };
}

export class TradfiStore {
  private quotes = new Map<string, TradfiLiveQuote>();
  private instruments = new Map<string, TradfiInstrument>();
  private spot = new Map<string, number>();

  setInstruments(insts: TradfiInstrument[]): void {
    this.instruments.clear();
    for (const i of insts) this.instruments.set(i.streamerSymbol, i);
  }

  allInstruments(): TradfiInstrument[] {
    return [...this.instruments.values()];
  }

  instrumentsFor(underlying: string, expiry: string): TradfiInstrument[] {
    return this.allInstruments().filter((i) => i.underlying === underlying && i.expiry === expiry);
  }

  getInstrument(streamerSymbol: string): TradfiInstrument | undefined {
    return this.instruments.get(streamerSymbol);
  }

  listUnderlyings(): string[] {
    return [...new Set(this.allInstruments().map((i) => i.underlying))].sort();
  }

  listExpiries(underlying: string): string[] {
    const set = new Set<string>();
    for (const i of this.allInstruments()) if (i.underlying === underlying) set.add(i.expiry);
    return [...set].sort();
  }

  mergeQuote(streamerSymbol: string, patch: Partial<TradfiLiveQuote> & { ts: number }): void {
    const prev = this.quotes.get(streamerSymbol) ?? emptyQuote();
    this.quotes.set(streamerSymbol, { ...prev, ...patch });
  }

  getQuote(streamerSymbol: string): TradfiLiveQuote | undefined {
    return this.quotes.get(streamerSymbol);
  }

  /** True if any instrument in this chain has received at least one quote. */
  hasQuotesFor(underlying: string, expiry: string): boolean {
    for (const inst of this.instrumentsFor(underlying, expiry)) {
      const q = this.quotes.get(inst.streamerSymbol);
      if (q != null && q.ts > 0) return true;
    }
    return false;
  }

  setSpot(underlying: string, price: number): void {
    this.spot.set(underlying, price);
  }

  getSpot(underlying: string): number | null {
    return this.spot.get(underlying) ?? null;
  }
}
