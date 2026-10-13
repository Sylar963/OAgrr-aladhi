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

/** Underlying session state for change-vs-close views. `prevDayId` is days since 1970-01-01. */
export interface UnderlyingSession {
  lastTrade: number | null;
  prevClose: number | null;
  prevDayId: number | null;
  ts: number;
}

const EMPTY_CHAIN: readonly TradfiInstrument[] = [];

const chainKey = (underlying: string, expiry: string) => `${underlying}|${expiry}`;

export class TradfiStore {
  private quotes = new Map<string, TradfiLiveQuote>();
  private instruments = new Map<string, TradfiInstrument>();
  // The catalog holds ~400k instruments; every chain lookup goes through these indexes.
  private byChain = new Map<string, TradfiInstrument[]>();
  private expiriesByUnderlying = new Map<string, string[]>();
  private underlyings: string[] = [];
  private spot = new Map<string, number>();
  private sessions = new Map<string, UnderlyingSession>();

  setInstruments(insts: TradfiInstrument[]): void {
    this.instruments.clear();
    this.byChain.clear();
    const expiries = new Map<string, Set<string>>();
    for (const i of insts) {
      this.instruments.set(i.streamerSymbol, i);
      const key = chainKey(i.underlying, i.expiry);
      const chain = this.byChain.get(key);
      if (chain) chain.push(i);
      else this.byChain.set(key, [i]);
      const set = expiries.get(i.underlying) ?? new Set<string>();
      set.add(i.expiry);
      expiries.set(i.underlying, set);
    }
    this.expiriesByUnderlying = new Map([...expiries].map(([u, set]) => [u, [...set].sort()]));
    this.underlyings = [...expiries.keys()].sort();
  }

  allInstruments(): TradfiInstrument[] {
    return [...this.instruments.values()];
  }

  instrumentCount(): number {
    return this.instruments.size;
  }

  instrumentsFor(underlying: string, expiry: string): readonly TradfiInstrument[] {
    return this.byChain.get(chainKey(underlying, expiry)) ?? EMPTY_CHAIN;
  }

  getInstrument(streamerSymbol: string): TradfiInstrument | undefined {
    return this.instruments.get(streamerSymbol);
  }

  listUnderlyings(): string[] {
    return [...this.underlyings];
  }

  underlyingCount(): number {
    return this.underlyings.length;
  }

  listExpiries(underlying: string): string[] {
    return [...(this.expiriesByUnderlying.get(underlying) ?? [])];
  }

  mergeQuote(streamerSymbol: string, patch: Partial<TradfiLiveQuote> & { ts: number }): void {
    const prev = this.quotes.get(streamerSymbol) ?? emptyQuote();
    this.quotes.set(streamerSymbol, { ...prev, ...patch });
  }

  getQuote(streamerSymbol: string): TradfiLiveQuote | undefined {
    return this.quotes.get(streamerSymbol);
  }

  /** Null out fields whose stream was dropped, so frozen values don't pass as live. */
  clearQuoteFields(streamerSymbol: string, fields: readonly (keyof Omit<TradfiLiveQuote, 'ts'>)[]): void {
    const prev = this.quotes.get(streamerSymbol);
    if (prev == null) return;
    const next = { ...prev };
    for (const f of fields) next[f] = null;
    this.quotes.set(streamerSymbol, next);
  }

  /** True if any instrument in this chain has received at least one quote. */
  hasQuotesFor(underlying: string, expiry: string): boolean {
    return this.newestQuoteTs(underlying, expiry) > 0;
  }

  /** Newest quote timestamp across this chain (0 if none) — for staleness checks. */
  newestQuoteTs(underlying: string, expiry: string): number {
    let newest = 0;
    for (const inst of this.instrumentsFor(underlying, expiry)) {
      const q = this.quotes.get(inst.streamerSymbol);
      if (q != null && q.ts > newest) newest = q.ts;
    }
    return newest;
  }

  setSpot(underlying: string, price: number): void {
    this.spot.set(underlying, price);
  }

  getSpot(underlying: string): number | null {
    return this.spot.get(underlying) ?? null;
  }

  mergeSession(underlying: string, patch: Partial<UnderlyingSession> & { ts: number }): void {
    const prev = this.sessions.get(underlying) ?? { lastTrade: null, prevClose: null, prevDayId: null, ts: 0 };
    this.sessions.set(underlying, { ...prev, ...patch });
  }

  getSession(underlying: string): UnderlyingSession | undefined {
    return this.sessions.get(underlying);
  }
}
