import type WebSocket from 'ws';
import {
  BYBIT_INSTRUMENTS_INFO,
  BYBIT_REST_BASE_URL,
  BYBIT_SYSTEM_STATUS,
  BYBIT_TICKERS,
  BYBIT_WS_URL,
} from '../shared/endpoints.js';
import {
  DEFAULT_SURFACE_COVERAGE,
  SdkBaseAdapter,
  type CachedInstrument,
} from '../shared/sdk-base.js';
import { TopicShardAllocator, aggregateShardState } from '../shared/topic-shards.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import type { VenueConnectionState } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseBybitCommandResponse,
  parseBybitInstrumentsResponse,
  parseBybitRestTicker,
  parseBybitSystemStatusResponse,
  parseBybitTickersResponse,
  parseBybitWsMessage,
} from './codec.js';
import { deriveBybitHealth } from './health.js';
import {
  BYBIT_MAX_TOPICS_PER_CONNECTION,
  buildBybitExpiredTopics,
  chunkBybitTopics,
  buildBybitSubscriptionTopics,
  createBybitSubscriptionState,
  markBybitSubscribedTopics,
  removeBybitSubscribedTopics,
  resetBybitSubscriptionState,
} from './planner.js';
import { buildBybitRestQuote, buildBybitWsQuote } from './state.js';
import { BYBIT_OPTION_SYMBOL_RE, type BybitInstrument } from './types.js';

const log = feedLogger('bybit');

// Bybit options don't expose per-instrument fees via public API
const BYBIT_DEFAULT_MAKER_FEE = 0.0002;
const BYBIT_DEFAULT_TAKER_FEE = 0.0005;

// Bybit asks for {"op":"ping"} every 20s. Pings do not protect against the server
// dropping a consumer that stops reading: a ≥15s event-loop stall closes the socket
// with 1006 (10s survives), and a consumer that cannot keep up is dropped after
// a few minutes — keep the hot path cheap and the event loop unblocked.
const BYBIT_PING_INTERVAL_MS = 20_000;

/**
 * Bybit options adapter using raw WebSocket + fetch.
 *
 * REST (instrument loading + initial snapshot):
 *   GET /v5/market/instruments-info?category=option
 *   GET /v5/market/tickers?category=option&baseCoin=X
 *
 * WebSocket (live updates):
 *   wss://stream.bybit.com/v5/public/option
 *   Per-instrument topics: tickers.{symbol}
 *   Messages are snapshots — each push replaces the full state.
 *
 * REST vs WS field name differences (both verified 2026-03-20):
 *   REST: bid1Price, ask1Price, bid1Iv, ask1Iv, markIv
 *   WS:   bidPrice,  askPrice,  bidIv,  askIv,  markPriceIv
 *
 * Settlement: USDT-settled, linear. No inverse conversion.
 */
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

// Bybit requires explicit baseCoin — no wildcard like Deribit's currency:'any'.
// These are all underlyings with active options as of 2026-03-28.
const BASE_COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP'] as const;

export class BybitWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'bybit';

  private readonly shardClients: TopicWsClient[] = [];
  private readonly shardStates: VenueConnectionState[] = [];
  private readonly shardAllocator = new TopicShardAllocator(BYBIT_MAX_TOPICS_PER_CONNECTION);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly subscriptions = createBybitSubscriptionState();
  private wsState: VenueConnectionState = 'down';
  protected override surfaceCoverage = DEFAULT_SURFACE_COVERAGE;

  protected initClients(): void {}

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    // Bybit returns only BTC when baseCoin is omitted — must query each explicitly.
    for (const baseCoin of BASE_COINS) {
      let cursor: string | undefined;

      do {
        const url = new URL(BYBIT_INSTRUMENTS_INFO, BYBIT_REST_BASE_URL);
        url.searchParams.set('category', 'option');
        url.searchParams.set('baseCoin', baseCoin);
        url.searchParams.set('limit', '1000');
        if (cursor) url.searchParams.set('cursor', cursor);

        const raw = await this.fetchJson(url);
        const parsed = parseBybitInstrumentsResponse(raw);

        if (parsed == null) {
          log.warn({ baseCoin }, 'instruments response validation failed');
          break;
        }

        if (parsed.retCode !== 0) {
          log.warn({ baseCoin, msg: parsed.retMsg }, 'instruments request failed');
          break;
        }

        for (const item of parsed.result.list) {
          const inst = this.parseInstrument(item);
          if (inst) instruments.push(inst);
        }

        cursor = parsed.result.nextPageCursor || undefined;
      } while (cursor);
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    await this.fetchBulkTickers(instruments);

    // Poll for new strikes/expiries every 10 minutes — Bybit has no instrument
    // lifecycle push channel unlike Deribit's instrument.state.
    this.refreshTimer = setInterval(() => {
      void this.refreshInstruments();
    }, INSTRUMENT_REFRESH_INTERVAL_MS);
    this.healthTimer = setInterval(() => {
      void this.refreshHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
    void this.refreshHealth();

    return instruments;
  }

  /**
   * Polls `get_instruments` for each baseCoin, sweeps expired instruments,
   * and subscribes any symbols not yet in our instrument map. Called every
   * 10 minutes to pick up new strikes/expiries and drop settled ones.
   */
  private async refreshInstruments(): Promise<void> {
    this.sweepExpiredState();

    const activeSymbols = new Set<string>();
    const newInstruments: CachedInstrument[] = [];

    for (const baseCoin of BASE_COINS) {
      try {
        let cursor: string | undefined;

        do {
          const url = new URL(BYBIT_INSTRUMENTS_INFO, BYBIT_REST_BASE_URL);
          url.searchParams.set('category', 'option');
          url.searchParams.set('baseCoin', baseCoin);
          url.searchParams.set('limit', '1000');
          if (cursor) url.searchParams.set('cursor', cursor);

          const raw = await this.fetchJson(url);
          const parsed = parseBybitInstrumentsResponse(raw);
          if (parsed == null || parsed.retCode !== 0) break;

          for (const item of parsed.result.list) {
            if (item.status === 'Trading') activeSymbols.add(item.symbol);
            if (this.instrumentMap.has(item.symbol)) continue;
            if (item.status !== 'Trading') continue;
            const inst = this.parseInstrument(item);
            if (!inst) continue;
            // Guard against the exchange still flagging a post-expiry instrument
            // as Trading — without this, sweepExpiredState() would re-add it.
            if (this.isExpiredInstrument(inst)) continue;
            newInstruments.push(inst);
          }

          cursor = parsed.result.nextPageCursor || undefined;
        } while (cursor);
      } catch (err: unknown) {
        log.warn({ baseCoin, err: String(err) }, 'instrument refresh failed');
        // If a baseCoin fetch fails, skip expiry detection for that coin to
        // avoid incorrectly removing instruments we just couldn't reach.
        for (const inst of this.instruments) {
          if (inst.base === baseCoin) activeSymbols.add(inst.exchangeSymbol);
        }
      }
    }

    // Remove instruments no longer present in the active set.
    const expiredSymbols = this.instruments
      .map((i) => i.exchangeSymbol)
      .filter((sym) => !activeSymbols.has(sym));

    if (expiredSymbols.length > 0) {
      const expiredTopics = buildBybitExpiredTopics(this.subscriptions, expiredSymbols);
      const expiredSymbolSet = new Set(expiredSymbols);

      for (const sym of expiredSymbols) {
        const inst = this.instrumentMap.get(sym);
        if (!inst) continue;
        this.instrumentMap.delete(sym);
        this.symbolIndex.delete(inst.symbol);
        this.quoteStore.delete(sym);
      }
      this.instruments = this.instruments.filter((i) => !expiredSymbolSet.has(i.exchangeSymbol));

      this.unsubscribeTopics(expiredTopics);

      log.info({ count: expiredSymbols.length }, 'removed expired instruments from refresh');
    }

    // Add and subscribe new instruments.
    if (newInstruments.length > 0) {
      for (const inst of newInstruments) {
        this.instruments.push(inst);
        this.instrumentMap.set(inst.exchangeSymbol, inst);
        this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
      }

      const plan = buildBybitSubscriptionTopics(this.subscriptions, newInstruments);

      if (plan.topics.length > 0) {
        try {
          await this.subscribeTopics(plan.topics);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn(
            { count: plan.topics.length, err: message },
            'failed to subscribe refreshed instruments',
          );
        }
      }

      log.info({ count: newInstruments.length }, 'added new instruments from refresh');
    }
  }

  private parseInstrument(item: BybitInstrument): CachedInstrument | null {
    const match = BYBIT_OPTION_SYMBOL_RE.exec(item.symbol);
    if (!match) return null;

    const base = match[1]!;
    const expiryRaw = match[2]!;
    const strikeStr = match[3]!;
    const expiry = this.parseExpiry(expiryRaw);
    // optionsType from the API ("Call"/"Put") is authoritative over the regex suffix.
    const right = item.optionsType === 'Call' ? ('call' as const) : ('put' as const);
    // item.settleCoin is authoritative — regex suffix is fallback for edge cases
    const settle = item.settleCoin || match[5] || 'USDT';

    const deliveryMs = item.deliveryTime != null ? Number(item.deliveryTime) : null;

    return {
      symbol: this.buildCanonicalSymbol(base, settle, expiry, Number(strikeStr), right),
      exchangeSymbol: item.symbol,
      base,
      quote: item.quoteCoin,
      settle,
      expiry,
      expirationTimestamp: Number.isFinite(deliveryMs) ? deliveryMs : null,
      strike: Number(strikeStr),
      right,
      inverse: false,
      contractSize: 1,
      contractMultiplierBase: 1,
      contractValueCurrency: base,
      tickSize: this.safeNum(item.priceFilter.tickSize),
      minQty: this.safeNum(item.lotSizeFilter.minOrderQty),
      lotSize: this.safeNum(item.lotSizeFilter.qtyStep),
      makerFee: BYBIT_DEFAULT_MAKER_FEE,
      takerFee: BYBIT_DEFAULT_TAKER_FEE,
    };
  }

  // ── initial REST snapshot ─────────────────────────────────────

  private async fetchBulkTickers(instruments: CachedInstrument[]): Promise<void> {
    const baseCoins = [...new Set(instruments.map((i) => i.base))];

    for (const baseCoin of baseCoins) {
      try {
        const url = new URL(BYBIT_TICKERS, BYBIT_REST_BASE_URL);
        url.searchParams.set('category', 'option');
        url.searchParams.set('baseCoin', baseCoin);

        const raw = await this.fetchJson(url);
        const parsed = parseBybitTickersResponse(raw);

        if (parsed == null) {
          log.warn({ baseCoin }, 'tickers validation failed');
          continue;
        }

        if (parsed.retCode !== 0) continue;

        for (const item of parsed.result.list) {
          const ticker = parseBybitRestTicker(item);
          if (ticker == null) continue;
          this.quoteStore.set(
            ticker.symbol,
            buildBybitRestQuote(ticker, (value) => this.safeNum(value)),
          );
        }

        log.info({ count: parsed.result.list.length, baseCoin }, 'fetched tickers');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ baseCoin, err: message }, 'failed to fetch tickers');
      }
    }
  }

  // ── WebSocket connection ──────────────────────────────────────

  protected async subscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    const plan = buildBybitSubscriptionTopics(this.subscriptions, instruments);

    if (plan.topics.length === 0) return;

    await this.subscribeTopics(plan.topics);

    log.info(
      {
        count: plan.topics.length,
        totalTopics: this.shardAllocator.size,
        connections: this.shardAllocator.shardCount,
      },
      'subscribed to option tickers',
    );
  }

  protected override async unsubscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    const topics = instruments
      .map((instrument) => `tickers.${instrument.exchangeSymbol}`)
      .filter((topic) => this.subscriptions.subscribedTopics.has(topic));

    if (topics.length === 0) return;

    removeBybitSubscribedTopics(this.subscriptions, topics);
    this.unsubscribeTopics(topics);
  }

  protected async unsubscribeAll(): Promise<void> {
    if (this.subscriptions.subscribedTopics.size === 0) return;

    const topics = [...this.subscriptions.subscribedTopics];
    resetBybitSubscriptionState(this.subscriptions);
    this.unsubscribeTopics(topics);
  }

  /**
   * Assigns topics to connection shards (≤2000 args each) and subscribes them.
   * A shard that has to (re)connect picks the new topics up through its replay,
   * so explicit subscribe frames only go to shards that were already open.
   */
  private async subscribeTopics(topics: string[]): Promise<void> {
    const groups = this.shardAllocator.assign(topics);
    markBybitSubscribedTopics(this.subscriptions, topics);

    for (const [shard, shardTopics] of groups) {
      const client = this.shardClient(shard);
      if (!client.isConnected) {
        try {
          await client.connect();
        } catch (error: unknown) {
          removeBybitSubscribedTopics(this.subscriptions, shardTopics);
          this.shardAllocator.release(shardTopics);
          throw error;
        }
        continue;
      }
      for (const args of chunkBybitTopics(shardTopics)) {
        client.send({ op: 'subscribe', args });
      }
    }
  }

  private unsubscribeTopics(topics: string[]): void {
    for (const [shard, shardTopics] of this.shardAllocator.release(topics)) {
      const client = this.shardClients[shard];
      if (!client?.isConnected) continue;
      for (const args of chunkBybitTopics(shardTopics)) {
        client.send({ op: 'unsubscribe', args });
      }
    }
  }

  private shardClient(shard: number): TopicWsClient {
    const existing = this.shardClients[shard];
    if (existing) return existing;

    const client = new TopicWsClient(
      BYBIT_WS_URL,
      shard === 0 ? 'bybit-ws' : `bybit-ws-${shard}`,
      {
        pingIntervalMs: BYBIT_PING_INTERVAL_MS,
        pingMessage: { op: 'ping' },
        onStatusChange: (state) => {
          this.shardStates[shard] =
            state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting';
          this.wsState = aggregateShardState(this.shardStates);
          this.emitStatus(this.wsState);
        },
        getReplayMessages: () =>
          chunkBybitTopics(this.shardAllocator.topicsFor(shard)).map((args) => ({
            op: 'subscribe',
            args,
          })),
        onMessage: (raw) => {
          this.handleRawMessage(raw);
        },
      },
    );
    this.shardClients[shard] = client;
    this.shardStates[shard] = 'down';
    return client;
  }

  private async refreshHealth(): Promise<void> {
    try {
      const url = new URL(BYBIT_SYSTEM_STATUS, BYBIT_REST_BASE_URL);
      const raw = await this.fetchJson(url);
      const parsed = parseBybitSystemStatusResponse(raw);
      const health = deriveBybitHealth(parsed, undefined, this.wsState);
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = deriveBybitHealth(null, error, this.wsState);
      this.emitStatus(health.status, health.message);
    }
  }

  // ── WS message handling ───────────────────────────────────────

  private handleRawMessage(raw: WebSocket.RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch (e: unknown) {
      log.debug({ err: String(e) }, 'malformed WS frame');
      return;
    }

    if (json == null || typeof json !== 'object') return;
    const obj = json as Record<string, unknown>;
    if (obj['op'] === 'pong') return;
    if (obj['success'] !== undefined) {
      this.handleCommandResponse(json);
      return;
    }

    const msg = parseBybitWsMessage(json);
    if (msg == null) return;
    if (!msg.topic.startsWith('tickers.')) return;

    const exchangeSymbol = msg.data.symbol;
    if (!this.instrumentMap.has(exchangeSymbol)) return;

    this.emitQuoteUpdate(
      exchangeSymbol,
      buildBybitWsQuote(msg.data, msg.ts, (value) => this.safeNum(value)),
    );
  }

  private handleCommandResponse(json: unknown): void {
    const resp = parseBybitCommandResponse(json);
    if (resp == null) return;

    const failTopics = resp.data?.failTopics ?? [];
    if (resp.success && failTopics.length === 0) return;

    // Rejected topics must not stay in local state, or replay would resend them
    // forever and the chain would look subscribed while never quoting.
    if (failTopics.length > 0) {
      removeBybitSubscribedTopics(this.subscriptions, failTopics);
      this.shardAllocator.release(failTopics);
    }
    log.warn(
      {
        op: resp.op,
        retMsg: resp.ret_msg,
        connId: resp.conn_id,
        failCount: failTopics.length,
        failSample: failTopics.slice(0, 5),
      },
      'bybit control message failed',
    );
  }

  // ── helpers ───────────────────────────────────────────────────

  private async fetchJson(url: URL): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bybit ${url.pathname} returned ${res.status}`);
    return res.json();
  }

  protected override getFeedConnectionSnapshot() {
    if (this.shardClients.length === 0) return null;

    let connected = true;
    let lastActivityAt = Number.POSITIVE_INFINITY;
    for (const client of this.shardClients) {
      connected &&= client.isConnected;
      lastActivityAt = Math.min(lastActivityAt, client.lastActivityAtMs || client.connectedAtMs);
    }
    return { connected, lastActivityAt };
  }

  protected override restartFeedFromWatchdog(): void {
    for (const client of this.shardClients) client.terminate();
  }

  private sweepExpiredState(): void {
    const removed = this.sweepExpiredInstruments();
    if (removed.length === 0) return;

    const expiredTopics = buildBybitExpiredTopics(
      this.subscriptions,
      removed.map((i) => i.exchangeSymbol),
    );

    this.unsubscribeTopics(expiredTopics);

    log.info({ count: removed.length }, 'removed expired instruments');
  }

  override async dispose(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.stopBaseTimers();
    await this.unsubscribeAll();
    await Promise.all(this.shardClients.map((client) => client.disconnect()));
    this.shardClients.length = 0;
    this.shardStates.length = 0;
    this.shardAllocator.clear();
  }
}
