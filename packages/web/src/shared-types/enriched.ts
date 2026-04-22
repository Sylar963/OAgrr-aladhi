export type {
  ChainStats,
  EnrichedChainResponse,
  EnrichedSide,
  EnrichedStrike,
  EstimatedFees,
  GexStrike,
  VenueConnectionState,
  VenueFailure,
  VenueId,
  VenueQuote,
  ServerWsMessage,
  SnapshotMeta,
  WsConnectionState,
  WsSubscriptionRequest,
} from '@oggregator/protocol';

export interface IvSurfaceRow {
  expiry: string;
  dte: number;
  delta10p: number | null;
  delta25p: number | null;
  atm: number | null;
  delta25c: number | null;
  delta10c: number | null;
}

// Per-strike smile point — mirrors core/enrichment.ts SmilePoint.
// Used by the Alpha analyzer and any surface-curve visualization.
export interface SmilePoint {
  strike: number;
  moneyness: number;
  callIv: number | null;
  putIv: number | null;
  blendedIv: number | null;
}

export interface SmileCurve {
  spot: number;
  points: SmilePoint[];
  atmIv: number | null;
  skew: number | null;
}

export type TermStructure = 'contango' | 'flat' | 'backwardation';

export interface VenueAtmPoint {
  expiry: string;
  dte: number;
  atm: number | null;
}

export interface IvSurfaceResponse {
  underlying: string;
  surface: IvSurfaceRow[];
  termStructure: TermStructure;
  venueAtm: Record<string, VenueAtmPoint[]>;
}
