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

export type TermStructure = 'contango' | 'flat' | 'backwardation';

export interface IvSurfaceResponse {
  underlying: string;
  surface: IvSurfaceRow[];
  termStructure: TermStructure;
}
