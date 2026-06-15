import type { TastytradeRest } from './rest.js';
import { nestedChainToInstruments, type TradfiInstrument } from './instrument.js';
import type { TradfiStore } from '../runtime/store.js';
import { feedLogger } from '../logger.js';
import { applyEvent } from './state.js';
import { chainSubscriptions, underlyingSubscriptions } from './planner.js';
import type { DxEvent, DxSub } from './codec.js';
import type { DxLinkClient } from './dxlink-client.js';
import { DxLinkClient as RealDxLinkClient } from './dxlink-client.js';

const log = feedLogger('tradfi-feed');
const MARKET_DATA_BATCH = 90; // under the 100-symbol cap, leaving room for the underlying

const QUOTE_TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // re-auth ~1h before the 24h expiry

export class TradfiFeed {
  private occIndex = new Map<string, TradfiInstrument>();
  private loaded = false;
  private dx: DxLinkClient | null = null;
  private desired: DxSub[] = [];
  private tokenTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly rest: TastytradeRest,
    private readonly store: TradfiStore,
    private readonly underlyings: string[],
    private readonly dxFactory: (opts: {
      url: string; token: string;
      onData: (e: DxEvent[]) => void; desiredSubs: () => DxSub[];
    }) => DxLinkClient = (opts) => new RealDxLinkClient(opts),
  ) {}

  async loadMarkets(): Promise<void> {
    const all: TradfiInstrument[] = [];
    for (const underlying of this.underlyings) {
      try {
        const data = await this.rest.getNestedChain(underlying);
        const insts = nestedChainToInstruments(data);
        all.push(...insts);
        log.info({ underlying, count: insts.length }, 'loaded chain');
      } catch (err: unknown) {
        log.warn({ underlying, err: String(err) }, 'chain load failed');
      }
    }
    this.store.setInstruments(all);
    this.occIndex.clear();
    for (const i of all) this.occIndex.set(i.occSymbol, i);
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async startStreaming(): Promise<void> {
    // Double-connect guard: tear down any existing connection and clear the token timer.
    if (this.tokenTimer) { clearInterval(this.tokenTimer); this.tokenTimer = null; }
    await this.dx?.disconnect();
    this.dx = null;

    const qt = await this.rest.getQuoteToken();
    const symbols = this.store.allInstruments().map((i) => i.streamerSymbol);
    this.desired = [...chainSubscriptions(symbols), ...underlyingSubscriptions(this.underlyings)];

    this.dx = this.dxFactory({
      url: qt.dxlinkUrl,
      token: qt.token,
      onData: (events) => {
        const ts = Date.now();
        for (const ev of events) applyEvent(this.store, ev, ts);
      },
      desiredSubs: () => this.desired,
    });
    await this.dx.connect();
    log.info({ subs: this.desired.length }, 'dxlink streaming started');

    this.tokenTimer = setInterval(() => {
      void this.reconnectStreaming();
    }, QUOTE_TOKEN_TTL_MS);
  }

  private async reconnectStreaming(): Promise<void> {
    try {
      await this.dx?.disconnect();
      await this.startStreaming();
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'dxlink token-refresh reconnect failed');
    }
  }

  async dispose(): Promise<void> {
    if (this.tokenTimer) { clearInterval(this.tokenTimer); this.tokenTimer = null; }
    await this.dx?.disconnect();
    this.dx = null;
  }

  /** REST snapshot: fetch quotes for one chain via /market-data/by-type. */
  async refreshChainQuotes(underlying: string, expiry: string): Promise<void> {
    const insts = this.store.instrumentsFor(underlying, expiry);
    if (insts.length === 0) return;

    const occSymbols = insts.map((i) => i.occSymbol);
    for (let i = 0; i < occSymbols.length; i += MARKET_DATA_BATCH) {
      const batch = occSymbols.slice(i, i + MARKET_DATA_BATCH);
      const data = await this.rest.getMarketData({ equityOption: batch });
      const ts = Date.now();
      for (const d of data) {
        const inst = this.occIndex.get(d.symbol);
        if (inst == null) continue;
        this.store.mergeQuote(inst.streamerSymbol, {
          bid: d.bid ?? null, ask: d.ask ?? null, bidSize: d.bidSize ?? null,
          askSize: d.askSize ?? null, mark: d.mark ?? d.mid ?? null, last: d.last ?? null,
          volume: d.volume ?? null, ts,
        });
      }
    }

    // underlying spot (index symbols use the `index` param; equities/ETFs use `equity`)
    const isIndex = underlying === 'SPX' || underlying === 'NDX' || underlying === 'RUT' || underlying === 'VIX';
    const spotData = await this.rest.getMarketData(
      isIndex ? { index: [underlying] } : { equity: [underlying] },
    );
    const spot = spotData.find((d) => d.symbol === underlying);
    const spotPrice = spot?.last ?? spot?.mark ?? spot?.mid ?? null;
    if (spotPrice != null) this.store.setSpot(underlying, spotPrice);
  }
}
