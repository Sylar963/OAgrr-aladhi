import type { ChainRequest, VenueDelta, VenueStatus } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';
import type { QuoteRecorderEvent } from '../shared/sdk-base.js';
import type { OptionVenueAdapter, VenueCapabilities } from '../shared/types.js';

export type FeedWorkerCallMethod =
  | 'loadMarkets'
  | 'listUnderlyings'
  | 'listExpiries'
  | 'listExpiryTimestamps'
  | 'fetchOptionChain'
  | 'dispose';

export type FeedDiagnostics = NonNullable<ReturnType<NonNullable<OptionVenueAdapter['getFeedDiagnostics']>>>;

export type FeedWorkerRequest =
  | { t: 'call'; id: number; venue: VenueId; method: FeedWorkerCallMethod; args: unknown[] }
  | { t: 'subscribe'; id: number; venue: VenueId; handlerId: number; request: ChainRequest }
  | { t: 'unsubscribe'; id: number; subscriptionId: number }
  | { t: 'removeDeltaHandler'; venue: VenueId; handlerId: number }
  | { t: 'recorder'; venue: VenueId; enabled: boolean };

export type FeedWorkerEvent =
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'deltas'; venue: VenueId; handlerId: number; deltas: VenueDelta[] }
  | { t: 'status'; venue: VenueId; handlerId: number; status: VenueStatus }
  | { t: 'marks'; venue: VenueId; events: QuoteRecorderEvent[] }
  | {
      t: 'diagnostics';
      venue: VenueId;
      capabilities: VenueCapabilities;
      diagnostics: FeedDiagnostics | null;
    };

/** The subset of `MessagePort` both ends use, so tests can run the pair over a `MessageChannel`. */
export interface FeedWorkerPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
}
