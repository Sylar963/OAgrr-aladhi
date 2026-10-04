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
    exchangeSymbol: string,
    underlying: string,
    fromTs: number,
    toTs: number,
  ) => Promise<IntervalFlow>;
  now?: () => number;
  intervalMs?: number;
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
}

export interface TapeTrade {
  venue: VenueId;
  instrument: string;
  side: 'buy' | 'sell';
  size: number;
  timestamp: number;
  isBlock: boolean;
}

export type IntervalFlowLookup = (
  venue: VenueId,
  exchangeSymbol: string,
  fromTs: number,
  toTs: number,
) => IntervalFlow;

/**
 * Indexes a trade tape once so each contract's net taker flow only scans that contract's
 * trades. The dealer-book tick looks up thousands of contracts; scanning the whole tape for
 * each one stalled the event loop for ~25 s per tick and dropped venue websockets.
 * Coverage is judged on the venue's whole tape: a contract that simply didn't trade earlier is
 * still covered, but a buffer that starts after fromTs may have dropped trades. Block trades are
 * excluded because their aggressor sign is ambiguous.
 */
export function indexIntervalFlow(trades: readonly TapeTrade[]): IntervalFlowLookup {
  const earliestByVenue = new Map<VenueId, number>();
  const byContract = new Map<string, TapeTrade[]>();
  for (const t of trades) {
    const earliest = earliestByVenue.get(t.venue);
    if (earliest === undefined || t.timestamp < earliest) earliestByVenue.set(t.venue, t.timestamp);
    if (t.isBlock) continue;
    const key = bookKey(t.venue, t.instrument);
    const list = byContract.get(key);
    if (list) list.push(t);
    else byContract.set(key, [t]);
  }
  return (venue, exchangeSymbol, fromTs, toTs) => {
    const earliest = earliestByVenue.get(venue) ?? Infinity;
    if (earliest > fromTs) return { netFlow: 0, hasFlow: false };
    let net = 0;
    let matched = false;
    for (const t of byContract.get(bookKey(venue, exchangeSymbol)) ?? []) {
      if (t.timestamp <= fromTs || t.timestamp > toTs) continue;
      net += t.side === 'buy' ? t.size : -t.size;
      matched = true;
    }
    return matched ? { netFlow: net, hasFlow: true } : { netFlow: 0, hasFlow: false };
  };
}

/** Net taker flow for one contract over (fromTs, toTs]; see indexIntervalFlow. */
export function netIntervalFlow(
  trades: readonly TapeTrade[],
  venue: VenueId,
  exchangeSymbol: string,
  fromTs: number,
  toTs: number,
): IntervalFlow {
  return indexIntervalFlow(trades)(venue, exchangeSymbol, fromTs, toTs);
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

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
    flowContracts: pos.flowContracts,
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
    flowContracts: row.flowContracts,
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

  setLogger(log: NonNullable<DealerBookServiceOptions['log']>): void {
    this.opts.log = log;
  }

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
    await Promise.allSettled([
      this.opts.oiSnapshotStore.dispose(),
      this.opts.dealerBookStore.dispose(),
    ]);
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
    const startedAt = Date.now();
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
            await yieldToEventLoop();
          }
        }
      }
    } catch (err) {
      this.opts.log.warn({ err: String(err) }, 'dealer book chain gather failed');
    }

    const tickTs = this.opts.now();
    const snapshots: PersistedOiSnapshot[] = [];
    const updated: DealerPosition[] = [];
    const gatheredAt = Date.now();

    try {
      for (const { chain, underlying } of chains) {
        await this.ingestChain(chain, underlying, tickTs, snapshots, updated);
        await yieldToEventLoop();
      }
      const ingestedAt = Date.now();

      await this.persist(snapshots, updated, tickTs);
      this.opts.log.info(
        {
          chains: chains.length,
          contracts: updated.length,
          gatherMs: gatheredAt - startedAt,
          ingestMs: ingestedAt - gatheredAt,
          persistMs: Date.now() - ingestedAt,
        },
        'dealer book tick',
      );
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
          // Trade tapes carry venue-native instrument names, not canonical symbols.
          flow = await this.opts.fetchIntervalFlow(
            input.venue,
            contract.exchangeSymbol,
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
