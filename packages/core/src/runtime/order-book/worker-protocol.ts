import type {
  BookFeedStatus,
  ThalexBookAuth,
  ThalexBookFeedEvents,
} from '../../feeds/thalex/book-feed.js';
import type { OrderBookSnapshot } from '../../liquidity/types.js';

export type OrderBookWorkerRequest =
  | { t: 'add'; instrument: string }
  | { t: 'remove'; instrument: string }
  | { t: 'auth'; auth: ThalexBookAuth | null }
  | { t: 'stop' };

export type OrderBookWorkerEvent =
  | { t: 'book'; book: OrderBookSnapshot }
  | { t: 'rejected'; instrument: string }
  | { t: 'status'; status: BookFeedStatus };

export interface OrderBookPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
}

export interface OrderBookFeedLike {
  add(instrument: string): void;
  remove(instrument: string): void;
  setAuth(auth: ThalexBookAuth | null): void;
  stop(): Promise<void>;
}

/** Worker side: owns the venue socket; the main thread only sees finished snapshots. */
export function serveOrderBookWorker(
  port: OrderBookPort,
  createFeed: (events: ThalexBookFeedEvents) => OrderBookFeedLike,
): void {
  const post = (event: OrderBookWorkerEvent): void => port.postMessage(event);
  const feed = createFeed({
    onBook: (book) => post({ t: 'book', book }),
    onRejected: (instrument) => post({ t: 'rejected', instrument }),
    onStatus: (status) => post({ t: 'status', status }),
  });
  port.on('message', (raw) => {
    const message = raw as OrderBookWorkerRequest;
    if (message.t === 'add') feed.add(message.instrument);
    else if (message.t === 'remove') feed.remove(message.instrument);
    else if (message.t === 'auth') feed.setAuth(message.auth);
    else if (message.t === 'stop') void feed.stop();
  });
}
