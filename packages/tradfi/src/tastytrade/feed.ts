import type { TastytradeRest } from './rest.js';
import { nestedChainToInstruments, type TradfiInstrument } from './instrument.js';
import type { TradfiStore } from '../runtime/store.js';
import { feedLogger } from '../logger.js';
import { applyEvent } from './state.js';
import { TradfiFlowBook } from '../runtime/flow-book.js';
import {
  type ChainTier, EVENT_QUOTE_FIELDS, planChainSubscriptions, underlyingSubscriptions,
} from './planner.js';
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

// Exponential backoff for connect failures: a failed (re)connect retries until it
// succeeds rather than silently leaving the feed dead.
const BASE_RECONNECT_BACKOFF_MS = 2 * 1000;
const MAX_RECONNECT_BACKOFF_MS = 60 * 1000;

// Chains nobody has requested for this long are unsubscribed, so browsing many tickers
// doesn't grow the DXLink subscription set for the life of the process.
const CHAIN_IDLE_MS = 5 * 60 * 1000;
const CHAIN_SWEEP_INTERVAL_MS = 60 * 1000;

// Per-chain REST-refresh throttle, so repeated /chains polls can't hammer REST.
const REFRESH_THROTTLE_MS = 15 * 1000;
// A 403 means the account lacks the market-data entitlement; it won't change within the hour.
const REST_FORBIDDEN_BACKOFF_MS = 60 * 60 * 1000;

// DXLink refuses subscriptions past an account cap ("subscription size is too big"), first
// seen at ~100k event subscriptions. Stay under it; a rejection lowers the budget further.
export const DEFAULT_MAX_SUBSCRIPTIONS = 80_000;
const MIN_SUBSCRIPTION_BUDGET = 10_000;
const BUDGET_SHRINK_COOLDOWN_MS = 30 * 1000;
const RESYNC_DELAY_MS = 5 * 1000;
// Chains requested this recently are in use and never evicted to make room for others.
// Must exceed the slowest keep-alive poll (the IV recorder's 60s).
const ACTIVE_LEASE_MS = 90 * 1000;

interface ChainLease {
  underlying: string;
  expiry: string;
  /** Last request time per tier; the subscribed set is the union of live tiers. */
  tiers: Map<ChainTier, number>;
  subs: DxSub[];
  /** False while the budget could not fit this chain's current tiers. */
  admitted: boolean;
}

export interface TradfiSubscriptionStats {
  subscriptions: number;
  budget: number;
  chains: number;
  deferredChains: number;
  rejects: number;
}

const subKey = (s: DxSub) => `${s.type}|${s.symbol}`;
const lastRequested = (lease: ChainLease) => Math.max(0, ...lease.tiers.values());

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
  readonly flowBook = new TradfiFlowBook();
  private occIndex = new Map<string, TradfiInstrument>();
  private catalogLoaded = false;
  private quoteTokenAcquired = false;
  private lastDataTs = 0;
  private dx: DxLinkClient | null = null;
  private chains = new Map<string, ChainLease>();
  private chainSubCount = 0;
  private maxSubscriptions: number;
  private subscriptionRejects = 0;
  private lastBudgetShrinkAt = 0;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private restForbiddenUntil = 0;
  private readonly sweepTimer = setInterval(() => this.evictIdleChains(), CHAIN_SWEEP_INTERVAL_MS);
  private quoteOnly = new Set<string>();
  private tokenTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  private lastReconnectAt = 0;
  private retryAttempts = 0;
  private lastRefreshAt = new Map<string, number>();

  constructor(
    private readonly rest: TastytradeRest,
    private readonly store: TradfiStore,
    private readonly underlyings: string[],
    private readonly dxFactory: (opts: {
      url: string; token: string;
      onData: (e: DxEvent[]) => void; desiredSubs: () => DxSub[];
      onAuthError: () => void; onSubscriptionRejected: (detail: string) => void;
    }) => DxLinkClient = (opts) => new RealDxLinkClient(opts),
    options: { maxSubscriptions?: number | undefined } = {},
  ) {
    this.maxSubscriptions = options.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS;
  }

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
      underlyings: this.store.underlyingCount(),
      instruments: this.store.instrumentCount(),
    };
  }

  subscriptionStats(): TradfiSubscriptionStats {
    let deferred = 0;
    for (const lease of this.chains.values()) if (!lease.admitted) deferred += 1;
    return {
      subscriptions: this.baseSubCount() + this.chainSubCount,
      budget: this.maxSubscriptions,
      chains: this.chains.size,
      deferredChains: deferred,
      rejects: this.subscriptionRejects,
    };
  }

  async startStreaming(): Promise<void> {
    await this.reconnectStreaming('initial');
  }

  /** Open a fresh DXLink stream (new quote token + connection). Throws on failure. */
  private async openStream(): Promise<void> {
    // Double-connect guard: tear down any existing connection and clear the token timer.
    if (this.tokenTimer) { clearTimeout(this.tokenTimer); this.tokenTimer = null; }
    await this.dx?.disconnect();
    this.dx = null;

    const qt = await this.rest.getQuoteToken();
    this.quoteTokenAcquired = true;
    // Subscribe lazily: only the underlyings (for spot) up front, plus any chains
    // already requested. Subscribing all ~85k instruments at once overflows the
    // DXLink message limit (INVALID_MESSAGE) and streams data no view consumes.
    this.dx = this.dxFactory({
      url: qt.dxlinkUrl,
      token: qt.token,
      onData: (events) => {
        const ts = Date.now();
        for (const ev of events) applyEvent(this.store, ev, ts, this.flowBook);
        this.lastDataTs = ts;
      },
      desiredSubs: () => this.desiredSubs(),
      // A rejected token means the timer-based refresh is too late; re-auth now.
      onAuthError: () => { void this.reconnectStreaming('auth-error'); },
      onSubscriptionRejected: (detail) => this.onSubscriptionRejected(detail),
    });
    await this.dx.connect();
    log.info({ subs: this.baseSubCount() + this.chainSubCount }, 'dxlink streaming started');

    const ttl = computeQuoteTokenTtl(qt.expiresAt, Date.now());
    this.tokenTimer = setTimeout(() => { void this.reconnectStreaming('token-expiry'); }, ttl);
  }

  /** Stream spot + previous close for symbols whose option chains are not loaded. */
  watchQuotes(symbols: readonly string[]): void {
    const added = symbols.filter((s) => !this.underlyings.includes(s) && !this.quoteOnly.has(s));
    if (added.length === 0) return;
    for (const s of added) this.quoteOnly.add(s);
    this.dx?.subscribe(underlyingSubscriptions(added));
  }

  /** The full subscription set: underlyings + every admitted chain. Sent once per connection. */
  private desiredSubs(): DxSub[] {
    const subs: DxSub[] = underlyingSubscriptions([...this.underlyings, ...this.quoteOnly]);
    for (const lease of this.chains.values()) subs.push(...lease.subs);
    return subs;
  }

  private baseSubCount(): number {
    return underlyingSubscriptions([...this.underlyings, ...this.quoteOnly]).length;
  }

  /**
   * Lease a chain at `tier` (idempotent) and keep it streaming until that tier goes
   * unrequested for CHAIN_IDLE_MS. A chain that doesn't fit the subscription budget stays
   * leased but deferred, and is retried on its next request or sweep.
   */
  ensureChainSubscribed(underlying: string, expiry: string, tier: ChainTier = 'full'): void {
    const key = `${underlying}|${expiry}`;
    const now = Date.now();
    let lease = this.chains.get(key);
    if (lease == null) {
      lease = { underlying, expiry, tiers: new Map(), subs: [], admitted: false };
      this.chains.set(key, lease);
    }
    const had = lease.tiers.has(tier);
    lease.tiers.set(tier, now);
    if (had && lease.admitted) return;
    this.applyLease(key, lease, now);
  }

  /** Drop tiers idle past CHAIN_IDLE_MS and retry deferred chains. Returns chains fully dropped. */
  evictIdleChains(now = Date.now()): number {
    let dropped = 0;
    let droppedSubs = 0;
    for (const [key, lease] of this.chains) {
      let changed = false;
      for (const [tier, at] of lease.tiers) {
        if (now - at <= CHAIN_IDLE_MS) continue;
        lease.tiers.delete(tier);
        changed = true;
      }
      if (lease.tiers.size === 0) {
        droppedSubs += lease.subs.length;
        this.dropLease(key, lease);
        dropped += 1;
      } else if (changed || !lease.admitted) {
        this.applyLease(key, lease, now);
      }
    }
    if (dropped > 0) {
      log.info({ chains: dropped, subs: droppedSubs, remaining: this.chains.size }, 'idle chains unsubscribed');
    }
    return dropped;
  }

  private applyLease(key: string, lease: ChainLease, now: number): void {
    const next = planChainSubscriptions(
      this.store.instrumentsFor(lease.underlying, lease.expiry),
      lease.tiers.keys(),
      this.store.getSpot(lease.underlying),
      now,
    );
    const growth = next.length - lease.subs.length;
    if (growth > 0 && !this.reserve(growth, key, now, false)) {
      if (lease.admitted || lease.subs.length === 0) {
        log.warn(
          { underlying: lease.underlying, expiry: lease.expiry, needed: growth, ...this.subscriptionStats() },
          'subscription budget full; chain deferred',
        );
      }
      lease.admitted = false;
      return;
    }
    const isNew = lease.subs.length === 0;
    this.replaceSubs(lease, next);
    lease.admitted = true;
    if (isNew) {
      log.info(
        { underlying: lease.underlying, expiry: lease.expiry, tiers: [...lease.tiers.keys()], subs: next.length },
        'chain subscription added',
      );
    }
  }

  /**
   * Make room for `needed` more chain subscriptions by evicting least-recently-requested
   * chains. Without `force`, chains still in active use are never evicted.
   */
  private reserve(needed: number, exceptKey: string | null, now: number, force: boolean): boolean {
    let over = this.chainSubCount + needed - Math.max(0, this.maxSubscriptions - this.baseSubCount());
    if (over <= 0) return true;
    const victims = [...this.chains]
      .filter(([k, l]) => k !== exceptKey && l.subs.length > 0 && (force || now - lastRequested(l) > ACTIVE_LEASE_MS))
      .sort((a, b) => lastRequested(a[1]) - lastRequested(b[1]));
    for (const [k, l] of victims) {
      if (over <= 0) break;
      over -= l.subs.length;
      this.dropLease(k, l);
    }
    return over <= 0;
  }

  private dropLease(key: string, lease: ChainLease): void {
    this.replaceSubs(lease, []);
    this.chains.delete(key);
  }

  private replaceSubs(lease: ChainLease, next: DxSub[]): void {
    const prevKeys = new Set(lease.subs.map(subKey));
    const nextKeys = new Set(next.map(subKey));
    const added = next.filter((s) => !prevKeys.has(subKey(s)));
    const removed = lease.subs.filter((s) => !nextKeys.has(subKey(s)));
    if (removed.length > 0) {
      this.dx?.unsubscribe(removed);
      for (const s of removed) this.store.clearQuoteFields(s.symbol, EVENT_QUOTE_FIELDS[s.type]);
    }
    if (added.length > 0) this.dx?.subscribe(added);
    this.chainSubCount += next.length - lease.subs.length;
    lease.subs = next;
  }

  /**
   * DXLink drops a refused frame, so its chains would never stream. "Too big" means the
   * account cap sits below our budget: lower it and evict down. Either way, re-send the
   * desired set once the burst settles.
   */
  private onSubscriptionRejected(detail: string): void {
    this.subscriptionRejects += 1;
    const now = Date.now();
    if (/too big/i.test(detail) && now - this.lastBudgetShrinkAt > BUDGET_SHRINK_COOLDOWN_MS) {
      this.lastBudgetShrinkAt = now;
      const current = this.baseSubCount() + this.chainSubCount;
      this.maxSubscriptions = Math.max(
        MIN_SUBSCRIPTION_BUDGET,
        Math.floor(Math.min(this.maxSubscriptions, current) * 0.8),
      );
      this.reserve(0, null, now, true);
      log.warn({ budget: this.maxSubscriptions, subscriptions: current }, 'dxlink subscription budget lowered');
    }
    if (this.resyncTimer != null) return;
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null;
      this.dx?.resubscribeAll();
    }, RESYNC_DELAY_MS);
  }

  /**
   * Resilient (re)connect: single-flight, an auth-error storm cooldown, and an
   * exponential backoff retry on failure so a failed connect never leaves the
   * feed silently dead — it keeps retrying until a stream is established.
   */
  private async reconnectStreaming(reason: string): Promise<void> {
    if (this.reconnecting) return;
    // Cooldown applies only to repeated auth-error triggers (storm guard). The
    // initial connect, scheduled token refresh, and backoff retries are exempt.
    if (reason === 'auth-error' && Date.now() - this.lastReconnectAt < MIN_RECONNECT_INTERVAL_MS) {
      log.warn({ reason }, 'dxlink reconnect throttled');
      return;
    }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.reconnecting = true;
    this.lastReconnectAt = Date.now();
    try {
      await this.openStream();
      this.retryAttempts = 0;
      if (reason !== 'initial') log.info({ reason }, 'dxlink reconnected');
    } catch (err: unknown) {
      this.retryAttempts += 1;
      const backoff = Math.min(
        MAX_RECONNECT_BACKOFF_MS,
        BASE_RECONNECT_BACKOFF_MS * 2 ** (this.retryAttempts - 1),
      );
      log.warn(
        { reason, attempt: this.retryAttempts, backoffMs: backoff, err: String(err) },
        'dxlink connect failed; retrying',
      );
      this.retryTimer = setTimeout(() => { void this.reconnectStreaming('retry'); }, backoff);
    } finally {
      this.reconnecting = false;
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.sweepTimer);
    if (this.resyncTimer) { clearTimeout(this.resyncTimer); this.resyncTimer = null; }
    if (this.tokenTimer) { clearTimeout(this.tokenTimer); this.tokenTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
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

    // Throttle per chain so repeated polls (and a 403-entitlement account) don't
    // hammer REST — at most one attempt per REFRESH_THROTTLE_MS per (underlying,expiry).
    const key = `${underlying}|${expiry}`;
    const nowMs = Date.now();
    if (nowMs < this.restForbiddenUntil) return 0;
    if (nowMs - (this.lastRefreshAt.get(key) ?? 0) < REFRESH_THROTTLE_MS) return 0;
    this.lastRefreshAt.set(key, nowMs);

    let merged = 0;
    const occSymbols = insts.map((i) => i.occSymbol);
    for (let i = 0; i < occSymbols.length; i += MARKET_DATA_BATCH) {
      const batch = occSymbols.slice(i, i + MARKET_DATA_BATCH);
      let data: Awaited<ReturnType<TastytradeRest['getMarketData']>>;
      try {
        data = await this.rest.getMarketData({ equityOption: batch });
      } catch (err: unknown) {
        if (!/-> 403\b/.test(String(err))) throw err;
        this.restForbiddenUntil = Date.now() + REST_FORBIDDEN_BACKOFF_MS;
        log.warn({ err: String(err) }, 'market-data REST not entitled (403); fallback paused for 1h');
        return merged;
      }
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
