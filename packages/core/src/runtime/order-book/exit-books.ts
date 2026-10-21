import type { CloseNowUnavailableReason, PositionLeg } from '@oggregator/protocol';

import {
  type ExitBookLookup,
  type ExitBookSource,
  exitInstrumentOf,
  exitVenueOf,
} from '../../portfolio/close-now.js';
import { feedLogger } from '../../utils/logger.js';
import {
  OrderBookCapacityError,
  type OrderBookLease,
  type OrderBookRuntime,
} from './order-book-runtime.js';

const log = feedLogger('exit-books');

export type ExitBookRuntime = Pick<OrderBookRuntime, 'acquire' | 'getBook' | 'isRejected'>;

/**
 * Close-now books for legs held on Thalex. Leases exactly the instruments `sync` was last
 * given, so the shared order-book runtime only streams what is held; released books linger
 * there before unsubscribing, which absorbs a leg briefly dropping out of the list.
 */
export class ThalexExitBooks implements ExitBookSource {
  private readonly leases = new Map<string, OrderBookLease>();
  private readonly failed = new Map<string, CloseNowUnavailableReason>();

  constructor(private readonly runtime: ExitBookRuntime) {}

  sync(legs: readonly PositionLeg[]): void {
    const wanted = new Set<string>();
    for (const leg of legs) {
      const instrument = this.instrumentOf(leg);
      if (instrument != null) wanted.add(instrument);
    }
    for (const [instrument, lease] of this.leases) {
      if (wanted.has(instrument)) continue;
      lease.release();
      this.leases.delete(instrument);
    }
    this.failed.clear();
    for (const instrument of wanted) {
      if (this.leases.has(instrument)) continue;
      try {
        this.leases.set(instrument, this.runtime.acquire(instrument));
      } catch (err) {
        const reason = err instanceof OrderBookCapacityError ? 'capacity' : 'loading';
        if (reason === 'loading') log.warn({ err: String(err), instrument }, 'exit book acquire failed');
        this.failed.set(instrument, reason);
      }
    }
  }

  lookup(leg: PositionLeg): ExitBookLookup {
    const instrument = this.instrumentOf(leg);
    if (instrument == null) return { kind: 'unsupported' };
    const failure = this.failed.get(instrument);
    if (failure != null) return { kind: 'unavailable', reason: failure };
    // A book that arrives after a refused subscribe wins: the rejected flag is not cleared on recovery.
    const book = this.runtime.getBook(instrument);
    if (book != null) return { kind: 'book', book };
    return { kind: 'unavailable', reason: this.runtime.isRejected(instrument) ? 'rejected' : 'loading' };
  }

  dispose(): void {
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear();
    this.failed.clear();
  }

  private instrumentOf(leg: PositionLeg): string | null {
    const venue = exitVenueOf(leg);
    return venue === 'thalex' ? exitInstrumentOf(leg, venue) : null;
  }
}
