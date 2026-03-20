// Types matching @oggregator/core enrichment output.
// Defined locally since the web package doesn't add @oggregator/core as a dependency.
// These must stay in sync with packages/core/src/core/enrichment.ts

export type VenueId = "deribit" | "okx" | "binance" | "bybit" | "derive";

export interface EstimatedFees {
  maker: number;
  taker: number;
}

export interface VenueQuote {
  bid:           number | null;
  ask:           number | null;
  mid:           number | null;
  bidSize:       number | null;
  askSize:       number | null;
  markIv:        number | null;
  bidIv:         number | null;
  askIv:         number | null;
  delta:         number | null;
  gamma:         number | null;
  theta:         number | null;
  vega:          number | null;
  spreadPct:     number | null;
  totalCost:     number | null;
  estimatedFees: EstimatedFees | null;
  openInterest:  number | null;
}

export interface EnrichedSide {
  venues:    Partial<Record<VenueId, VenueQuote>>;
  bestIv:    number | null;
  bestVenue: VenueId | null;
}

export interface EnrichedStrike {
  strike: number;
  call:   EnrichedSide;
  put:    EnrichedSide;
}

export interface IvSurfaceRow {
  expiry:   string;
  dte:      number;
  delta10p: number | null;
  delta25p: number | null;
  atm:      number | null;
  delta25c: number | null;
  delta10c: number | null;
}

export interface GexStrike {
  strike:         number;
  gexUsdMillions: number;
}

export type TermStructure = "contango" | "flat" | "backwardation";

export interface ChainStats {
  spotIndexUsd:    number | null;
  forwardPriceUsd: number | null;
  forwardBasisPct: number | null;
  atmStrike:       number | null;
  atmIv:           number | null;
  putCallOiRatio:  number | null;
  totalOiUsd:      number | null;
  skew25d:         number | null;
}

export interface EnrichedChainResponse {
  underlying: string;
  expiry:     string;
  dte:        number;
  stats:      ChainStats;
  strikes:    EnrichedStrike[];
  gex:        GexStrike[];
}

export interface IvSurfaceResponse {
  underlying:    string;
  surface:       IvSurfaceRow[];
  termStructure: TermStructure;
}
