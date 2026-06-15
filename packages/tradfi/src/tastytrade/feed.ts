import type { TastytradeRest } from './rest.js';
import { nestedChainToInstruments, type TradfiInstrument } from './instrument.js';
import type { TradfiStore } from '../runtime/store.js';
import { feedLogger } from '../logger.js';

const log = feedLogger('tradfi-feed');
const MARKET_DATA_BATCH = 90; // under the 100-symbol cap, leaving room for the underlying

export class TradfiFeed {
  private occIndex = new Map<string, TradfiInstrument>();
  private loaded = false;

  constructor(
    private readonly rest: TastytradeRest,
    private readonly store: TradfiStore,
    private readonly underlyings: string[],
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
