import {
  applyBookInterval,
  type BookLookup,
  bootstrapNaivePosition,
  type DealerPosition,
  type OiSnapshotInput,
  type VenueId,
  type VenueOptionChain,
} from '@oggregator/core';
import type {
  DealerBookStore,
  OiSnapshotStore,
  PersistedDealerPosition,
  PersistedOiSnapshot,
} from '@oggregator/db';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const SNAPSHOT_RETENTION_MS = 35 * 24 * 60 * 60 * 1000;

export interface IntervalFlow {
  netFlow: number;
  hasFlow: boolean;
}

export interface DealerBookServiceOptions {
  underlyings: string[];
  oiSnapshotStore: OiSnapshotStore;
  dealerBookStore: DealerBookStore;
  listExpiries: (underlying: string) => Promise<string[]>;
  listVenues: () => VenueId[];
  fetchChain: (
    venue: VenueId,
    underlying: string,
    expiry: string,
  ) => Promise<VenueOptionChain | null>;
  fetchIntervalFlow: (
    venue: VenueId,
    symbol: string,
    underlying: string,
    fromTs: number,
    toTs: number,
  ) => Promise<IntervalFlow>;
  now?: () => number;
  intervalMs?: number;
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}

function bookKey(venue: VenueId, symbol: string): string {
  return `${venue}:${symbol}`;
}

function toPersisted(pos: DealerPosition): PersistedDealerPosition {
  return {
    venue: pos.venue,
    underlying: pos.underlying,
    instrumentName: pos.symbol,
    expiry: pos.expiry,
    strike: pos.strike,
    optionType: pos.optionType,
    dealerContracts: pos.dealerContracts,
    lastOi: pos.lastOi,
    lastSnapshotTs: new Date(pos.lastSnapshotTs),
  };
}

function fromPersisted(row: PersistedDealerPosition): DealerPosition {
  return {
    venue: row.venue as VenueId,
    symbol: row.instrumentName,
    underlying: row.underlying,
    expiry: row.expiry ?? '',
    strike: row.strike,
    optionType: row.optionType,
    dealerContracts: row.dealerContracts,
    lastOi: row.lastOi,
    lastSnapshotTs: row.lastSnapshotTs.getTime(),
  };
}

/**
 * Owns the dealer inventory book: a ~15-min timer that snapshots OI per
 * venue·contract, attributes ΔOI to net taker flow, persists the running book,
 * and exposes a synchronous lookup for the chain enrichment paths.
 */
export class DealerBookService {
  private readonly book = new Map<string, DealerPosition>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly opts: Required<Pick<DealerBookServiceOptions, 'now' | 'intervalMs' | 'log'>> &
    DealerBookServiceOptions;

  constructor(options: DealerBookServiceOptions) {
    // Spread options first, then apply resolved defaults so an omitted (or
    // explicitly-undefined) now/intervalMs/log can never clobber the fallback.
    this.opts = {
      ...options,
      now: options.now ?? (() => Date.now()),
      intervalMs: options.intervalMs ?? FIFTEEN_MIN_MS,
      log: options.log ?? { info: () => {}, warn: () => {} },
    };
  }

  lookup: BookLookup = (venue, symbol) => this.book.get(bookKey(venue, symbol));

  async start(): Promise<void> {
    if (this.timer) return; // already started; don't stack intervals
    await this.warmFromStore();
    await this.runTick();
    this.timer = setInterval(() => {
      void this.runTick();
    }, this.opts.intervalMs);
  }

  async dispose(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async warmFromStore(): Promise<void> {
    try {
      const rows = await this.opts.dealerBookStore.loadAll(this.opts.underlyings);
      for (const row of rows) {
        const pos = fromPersisted(row);
        this.book.set(bookKey(pos.venue, pos.symbol), pos);
      }
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, 'dealer book warm-from-store failed');
    }
  }

  async runTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Collect chains first, then stamp a single tickTs so fetchChain closures
    // see the pre-tick state (important for injected test doubles that share a
    // counter between now() and fetchChain).
    const chains: Array<{ chain: VenueOptionChain; underlying: string }> = [];
    try {
      for (const underlying of this.opts.underlyings) {
        let expiries: string[];
        try {
          expiries = await this.opts.listExpiries(underlying);
        } catch (err) {
          this.opts.log.warn({ underlying, err: String(err) }, 'listExpiries failed');
          continue;
        }
        for (const expiry of expiries) {
          for (const venue of this.opts.listVenues()) {
            let chain: VenueOptionChain | null;
            try {
              chain = await this.opts.fetchChain(venue, underlying, expiry);
            } catch (err) {
              this.opts.log.warn(
                { venue, underlying, expiry, err: String(err) },
                'dealer book fetchChain failed; skipping',
              );
              chain = null;
            }
            if (chain != null) chains.push({ chain, underlying });
          }
        }
      }
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, 'dealer book chain gather failed');
    }

    const tickTs = this.opts.now();
    const snapshots: PersistedOiSnapshot[] = [];
    const updated: DealerPosition[] = [];

    try {
      for (const { chain, underlying } of chains) {
        await this.ingestChain(chain, underlying, tickTs, snapshots, updated);
      }

      await this.persist(snapshots, updated, tickTs);
    } finally {
      this.running = false;
    }
  }

  private async ingestChain(
    chain: VenueOptionChain,
    underlying: string,
    tickTs: number,
    snapshots: PersistedOiSnapshot[],
    updated: DealerPosition[],
  ): Promise<void> {
    for (const contract of Object.values(chain.contracts)) {
      const oi = contract.quote.openInterest;
      if (oi === null) continue;

      const input: OiSnapshotInput = {
        venue: contract.venue,
        symbol: contract.symbol,
        underlying,
        expiry: contract.expiry,
        strike: contract.strike,
        optionType: contract.right,
        openInterest: oi,
        snapshotTs: tickTs,
      };

      snapshots.push({
        venue: input.venue,
        underlying: input.underlying,
        instrumentName: input.symbol,
        expiry: input.expiry,
        strike: input.strike,
        optionType: input.optionType,
        openInterest: input.openInterest,
        snapshotTs: new Date(tickTs),
      });

      const key = bookKey(input.venue, input.symbol);
      const prior = this.book.get(key);
      let next: DealerPosition;
      if (prior === undefined) {
        next = bootstrapNaivePosition(input);
      } else {
        let flow: IntervalFlow;
        try {
          flow = await this.opts.fetchIntervalFlow(
            input.venue,
            input.symbol,
            underlying,
            prior.lastSnapshotTs,
            tickTs,
          );
        } catch (err) {
          this.opts.log.warn(
            { venue: input.venue, symbol: input.symbol, err: String(err) },
            'fetchIntervalFlow failed; zeroing flow for this interval',
          );
          flow = { netFlow: 0, hasFlow: false };
        }
        next = applyBookInterval({
          prior,
          snapshot: input,
          netFlow: flow.netFlow,
          hasFlow: flow.hasFlow,
        });
      }
      this.book.set(key, next);
      updated.push(next);
    }
  }

  private async persist(
    snapshots: PersistedOiSnapshot[],
    updated: DealerPosition[],
    tickTs: number,
  ): Promise<void> {
    try {
      await this.opts.oiSnapshotStore.writeMany(snapshots);
      await this.opts.dealerBookStore.upsertMany(updated.map(toPersisted));
      await this.opts.oiSnapshotStore.prune(new Date(tickTs - SNAPSHOT_RETENTION_MS));
      // Drop contracts whose option expiry is already past — they never
      // reappear in fetched chains, so without this the book grows unbounded
      // with dead instruments. Prune by expiry date (the column's semantics),
      // NOT the snapshot-retention window, which governs oi_snapshots only.
      await this.opts.dealerBookStore.pruneExpired(new Date(tickTs).toISOString().slice(0, 10));
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, 'dealer book persist failed');
    }
  }
}
