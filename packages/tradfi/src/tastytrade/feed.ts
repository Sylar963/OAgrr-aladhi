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

// Quote tokens are valid ~24h. Refresh a margin before the real expiry; fall
// back to 23h when the API omits expires-at; never schedule under a minute.
const QUOTE_TOKEN_FALLBACK_TTL_MS = 23 * 60 * 60 * 1000;
const QUOTE_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MIN_TOKEN_TTL_MS = 60 * 1000;

// Floor between auth-failure-triggered reconnects, so a bad token cannot drive a
// fetch/connect storm. The scheduled (expiry) refresh fires far outside this window.
const MIN_RECONNECT_INTERVAL_MS = 60 * 1000;

const INDEX_UNDERLYINGS = new Set(['SPX', 'NDX', 'RUT', 'VIX']);

/** Compute ms until the quote token should be refreshed, given its expiry timestamp. */
export function computeQuoteTokenTtl(expiresAt: string | null, now: number): number {
  if (!expiresAt) return QUOTE_TOKEN_FALLBACK_TTL_MS;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return QUOTE_TOKEN_FALLBACK_TTL_MS;
  return Math.max(MIN_TOKEN_TTL_MS, exp - now - QUOTE_TOKEN_REFRESH_MARGIN_MS);
}

/** Service readiness — every flag is observed, never assumed. */
export interface TradfiReadiness {
  /** At least one instrument was loaded from the option-chain catalog. */
  catalogLoaded: boolean;
  /** A DXLink quote token was acquired at least once. */
  quoteTokenAcquired: boolean;
  /** DXLink is connected, authorized, and the feed channel is subscribed. */
  streaming: boolean;
  /** Epoch ms of the last applied streaming event (0 if none has arrived). */
  lastDataTs: number;
  /** Distinct underlyings loaded into the catalog. */
  underlyings: number;
  /** Total instruments loaded into the catalog. */
  instruments: number;
}

export class TradfiFeed {
  private occIndex = new Map<string, TradfiInstrument>();
  private catalogLoaded = false;
  private quoteTokenAcquired = false;
  private lastDataTs = 0;
  private dx: DxLinkClient | null = null;
  private desired: DxSub[] = [];
  private subscribedChains = new Set<string>();
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  private lastReconnectAt = 0;

  constructor(
    private readonly rest: TastytradeRest,
    private readonly store: TradfiStore,
    private readonly underlyings: string[],
    private readonly dxFactory: (opts: {
      url: string; token: string;
      onData: (e: DxEvent[]) => void; desiredSubs: () => DxSub[];
      onAuthError: () => void;
    }) => DxLinkClient = (opts) => new RealDxLinkClient(opts),
  ) {}

  async loadMarkets(): Promise<void> {
    const all: TradfiInstrument[] = [];
    let failures = 0;
    for (const underlying of this.underlyings) {
      try {
        const data = await this.rest.getNestedChain(underlying);
        const insts = nestedChainToInstruments(data);
        all.push(...insts);
        log.info({ underlying, count: insts.length }, 'loaded chain');
      } catch (err: unknown) {
        failures += 1;
        log.warn({ underlying, err: String(err) }, 'chain load failed');
      }
    }
    this.store.setInstruments(all);
    this.occIndex.clear();
    for (const i of all) this.occIndex.set(i.occSymbol, i);
    // Honest readiness: only "loaded" if the catalog actually holds instruments.
    this.catalogLoaded = all.length > 0;
    if (!this.catalogLoaded) {
      log.error({ failures, underlyings: this.underlyings.length }, 'catalog empty — no chains loaded');
    }
  }

  readiness(): TradfiReadiness {
    return {
      catalogLoaded: this.catalogLoaded,
      quoteTokenAcquired: this.quoteTokenAcquired,
      streaming: this.dx?.isStreaming() ?? false,
      lastDataTs: this.lastDataTs,
      underlyings: this.store.listUnderlyings().length,
      instruments: this.store.allInstruments().length,
    };
  }

  async startStreaming(): Promise<void> {
    // Double-connect guard: tear down any existing connection and clear the token timer.
    if (this.tokenTimer) { clearTimeout(this.tokenTimer); this.tokenTimer = null; }
    await this.dx?.disconnect();
    this.dx = null;

    const qt = await this.rest.getQuoteToken();
    this.quoteTokenAcquired = true;
    // Subscribe lazily: only the underlyings (for spot) up front, plus any chains
    // already requested. Subscribing all ~85k instruments at once overflows the
    // DXLink message limit (INVALID_MESSAGE) and streams data no view consumes.
    this.rebuildDesired();

    this.dx = this.dxFactory({
      url: qt.dxlinkUrl,
      token: qt.token,
      onData: (events) => {
        const ts = Date.now();
        for (const ev of events) applyEvent(this.store, ev, ts);
        this.lastDataTs = ts;
      },
      desiredSubs: () => this.desired,
      // A rejected token means the timer-based refresh is too late; re-auth now.
      onAuthError: () => { void this.reconnectStreaming('auth-error'); },
    });
    await this.dx.connect();
    log.info({ subs: this.desired.length }, 'dxlink streaming started');

    const ttl = computeQuoteTokenTtl(qt.expiresAt, Date.now());
    this.tokenTimer = setTimeout(() => { void this.reconnectStreaming('token-expiry'); }, ttl);
  }

  /** Rebuild the desired subscription set: underlyings + every requested chain. */
  private rebuildDesired(): void {
    const subs: DxSub[] = [...underlyingSubscriptions(this.underlyings)];
    for (const key of this.subscribedChains) {
      const sep = key.indexOf('|');
      const u = key.slice(0, sep);
      const e = key.slice(sep + 1);
      const symbols = this.store.instrumentsFor(u, e).map((i) => i.streamerSymbol);
      subs.push(...chainSubscriptions(symbols));
    }
    this.desired = subs;
  }

  /** Subscribe a single chain's symbols on demand (idempotent). Survives reconnects. */
  ensureChainSubscribed(underlying: string, expiry: string): void {
    const key = `${underlying}|${expiry}`;
    if (this.subscribedChains.has(key)) return;
    this.subscribedChains.add(key);
    const symbols = this.store.instrumentsFor(underlying, expiry).map((i) => i.streamerSymbol);
    const subs = chainSubscriptions(symbols);
    this.rebuildDesired();
    if (subs.length > 0) this.dx?.subscribe(subs);
    log.info({ underlying, expiry, subs: subs.length }, 'chain subscription added');
  }

  private async reconnectStreaming(reason: string): Promise<void> {
    if (this.reconnecting) return;
    const now = Date.now();
    if (now - this.lastReconnectAt < MIN_RECONNECT_INTERVAL_MS) {
      log.warn({ reason }, 'dxlink reconnect throttled');
      return;
    }
    this.reconnecting = true;
    this.lastReconnectAt = now;
    try {
      await this.dx?.disconnect();
      this.dx = null;
      await this.startStreaming();
      log.info({ reason }, 'dxlink reconnected');
    } catch (err: unknown) {
      log.warn({ reason, err: String(err) }, 'dxlink reconnect failed');
    } finally {
      this.reconnecting = false;
    }
  }

  async dispose(): Promise<void> {
    if (this.tokenTimer) { clearTimeout(this.tokenTimer); this.tokenTimer = null; }
    await this.dx?.disconnect();
    this.dx = null;
  }

  /**
   * REST snapshot fallback: fetch quotes for one chain via /market-data/by-type.
   * Returns the number of option quotes merged. Best-effort — callers handle the
   * account-entitlement case (this endpoint is 403 without real-time market data).
   */
  async refreshChainQuotes(underlying: string, expiry: string): Promise<number> {
    const insts = this.store.instrumentsFor(underlying, expiry);
    if (insts.length === 0) return 0;

    let merged = 0;
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
        merged += 1;
      }
    }

    // underlying spot (index symbols use the `index` param; equities/ETFs use `equity`)
    const spotData = await this.rest.getMarketData(
      INDEX_UNDERLYINGS.has(underlying) ? { index: [underlying] } : { equity: [underlying] },
    );
    const spot = spotData.find((d) => d.symbol === underlying);
    const spotPrice = spot?.last ?? spot?.mark ?? spot?.mid ?? null;
    if (spotPrice != null) this.store.setSpot(underlying, spotPrice);

    return merged;
  }
}
