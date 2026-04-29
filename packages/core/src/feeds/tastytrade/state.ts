// In-memory live quote store: streamerSymbol → latest Quote/Greeks/Trade fields.
// Mirrors state.ts in other venues. Pure data, no I/O.

export interface TastytradeQuote {
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

export interface TastytradeContractMeta {
  /** Canonical oggregator symbol e.g. `NVDA/USD:USD-260117-200-C` */
  canonical: string;
  /** DXFeed streamer symbol e.g. `.NVDA260117C200` */
  streamerSymbol: string;
  /** OCC symbol e.g. `NVDA  260117C00200000` */
  occ: string;
  underlying: string;
  expiry: string;
  strike: number;
  right: 'call' | 'put';
  exerciseStyle: 'american' | 'european';
  multiplier: number;
}

export interface TastytradeState {
  /** Quotes keyed by streamer symbol */
  quotes: Map<string, TastytradeQuote>;
  /** Contract metadata keyed by streamer symbol */
  contracts: Map<string, TastytradeContractMeta>;
}

export function createTastytradeState(): TastytradeState {
  return {
    quotes: new Map(),
    contracts: new Map(),
  };
}
