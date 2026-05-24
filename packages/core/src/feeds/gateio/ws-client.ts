import type WebSocket from 'ws';
import type { ChainRequest, VenueOptionChain } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  GATEIO_OPTIONS_CONTRACTS,
  GATEIO_OPTIONS_EXPIRATIONS,
  GATEIO_OPTIONS_TICKERS,
  GATEIO_OPTIONS_UNDERLYINGS,
  GATEIO_OPTIONS_WS_URL,
  GATEIO_REST_BASE_URL,
} from '../shared/endpoints.js';
import { type CachedInstrument, type LiveQuote, SdkBaseAdapter } from '../shared/sdk-base.js';
import type { StreamHandlers } from '../shared/types.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import {
  parseGateioContracts,
  parseGateioExpirations,
  parseGateioTickers,
  parseGateioUnderlyings,
  parseGateioWsMessage,
} from './codec.js';
import { deriveGateioHealth, type GateioWsError } from './health.js';
import {
  buildGateioReplayFrames,
  buildGateioSubscribeFrames,
  buildGateioUnsubscribeFrames,
  createGateioSubscriptionState,
  pruneGateioSubscriptionState,
  type GateioFrame,
} from './planner.js';
import {
  applyGateioVolume,
  buildGateioInstrument,
  createGateioVolumeWindow,
  gateioPruneVolumeWindow,
  gateioRecordTrade,
  mergeGateioRestTicker,
  mergeGateioTrade,
  mergeGateioUnderlyingTicker,
  mergeGateioWsContractTicker,
  type GateioVolumeWindow,
} from './state.js';

const log = feedLogger('gateio');

const GATEIO_PING_INTERVAL_MS = 15_000;

const HEALTH_CHECK_INTERVAL_MS = 60_000;

const GATEIO_REST_TIMEOUT_MS = 10_000;

const GATEIO_WS_ERROR_LOG_COOLDOWN_MS = 30_000;

const GATEIO_QUOTE_STALE_RECONNECT_MS = 5 * 60_000;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Gate.io options adapter using raw WebSocket + fetch.
 *
 * REST (instrument loading + initial snapshot):
 *   GET /api/v4/options/underlyings                                — underlying catalog
 *   GET /api/v4/options/expirations?underlying=...                 — per-underlying expirations
 *   GET /api/v4/options/contracts?underlying=...&expiration=...    — instruments per expiry
 *   GET /api/v4/options/tickers?underlying=...                     — initial quote snapshot
 *
 * WebSocket (wss://op-ws.gateio.live/v4/ws/usdt):
 *   options.contract_tickers      — per-contract bid/ask/mark/IV/greeks
 *   options.trades                — per-contract trade prints
 *   options.ul_tickers            — index price for an underlying name (e.g. BTC_USDT)
 *
 * Heartbeat: JSON `{time, channel: 'options.ping'}` every 15s.
 */
export class GateioWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'gateio';

  private wsClient: TopicWsClient | null = null;
  private connectingPromise: Promise<void> | null = null;
  private readonly subscriptions = createGateioSubscriptionState();
  private readonly instrumentsByUnderlyingName = new Map<string, CachedInstrument[]>();
  private readonly volumeWindows = new Map<string, GateioVolumeWindow>();
  private lastWsError: GateioWsError | null = null;
  private restOk = false;
  private restLatencyMs = 0;
  private lastUpdateAt = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastQuoteStaleReconnectAt = 0;
  private lastWsErrorLogKey: string | null = null;
  private lastWsErrorLogAt = 0;

  protected initClients(): void {}

  override async listUnderlyings(): Promise<string[]> {
    this.pruneExpiredState();
    return super.listUnderlyings();
  }

  override async listExpiries(underlying: string): Promise<string[]> {
    this.pruneExpiredState();
    return super.listExpiries(underlying);
  }

  override fetchOptionChain(request: ChainRequest): Promise<VenueOptionChain> {
    this.pruneExpiredState();
    return super.fetchOptionChain(request);
  }

  override async subscribe(
    request: ChainRequest,
    handlers: StreamHandlers,
  ): Promise<() => Promise<void>> {
    this.pruneExpiredState();
    return super.subscribe(request, handlers);
  }

  protected override getFeedConnectionSnapshot() {
    const client = this.wsClient;
    if (client == null) return null;

    return {
      connected: client.isConnected,
      lastActivityAt: client.lastActivityAtMs || client.connectedAtMs,
    };
  }

  protected override restartFeedFromWatchdog(): void {
    this.wsClient?.terminate();
  }

  // ── instrument loading ────────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const startedAt = Date.now();
    const instruments: CachedInstrument[] = [];

    let underlyings: string[];
    try {
      const raw = await this.fetchGateioApi(GATEIO_OPTIONS_UNDERLYINGS);
      underlyings = parseGateioUnderlyings(raw).map((u) => u.name);
    } catch (err: unknown) {
      this.restOk = false;
      log.error({ err: String(err) }, 'failed to load underlyings');
      this.ensureHealthLoop();
      this.emitHealth();
      return instruments;
    }

    for (const underlying of underlyings) {
      let expirations: number[];
      try {
        const raw = await this.fetchGateioApi(GATEIO_OPTIONS_EXPIRATIONS, { underlying });
        expirations = parseGateioExpirations(raw);
      } catch (err: unknown) {
        log.warn({ underlying, err: String(err) }, 'failed to load expirations');
        continue;
      }

      for (const expiration of expirations) {
        try {
          const raw = await this.fetchGateioApi(GATEIO_OPTIONS_CONTRACTS, {
            underlying,
            expiration: String(expiration),
          });
          const contracts = parseGateioContracts(raw);
          for (const c of contracts) {
            try {
              instruments.push(buildGateioInstrument(c));
            } catch (err: unknown) {
              log.debug({ name: c.name, err: String(err) }, 'skipping contract');
            }
          }
        } catch (err: unknown) {
          log.warn({ underlying, expiration, err: String(err) }, 'failed to load contracts');
        }
      }
    }

    const activeInstruments = instruments.filter((instrument) => !this.isExpiredInstrument(instrument));

    log.info({ count: activeInstruments.length }, 'loaded option instruments');

    this.instrumentsByUnderlyingName.clear();
    for (const inst of activeInstruments) {
      this.quoteStore.set(inst.exchangeSymbol, this.emptyQuote());
      const key = `${inst.base}_USDT`;
      const bucket = this.instrumentsByUnderlyingName.get(key);
      if (bucket) bucket.push(inst);
      else this.instrumentsByUnderlyingName.set(key, [inst]);
    }

    for (const underlying of underlyings) {
      await this.fetchTickerSnapshot(underlying);
    }

    this.restOk = true;
    this.restLatencyMs = Date.now() - startedAt;

    this.ensureHealthLoop();
    this.emitHealth();

    return activeInstruments;
  }

  private ensureHealthLoop(): void {
    if (this.healthTimer == null) {
      this.healthTimer = setInterval(() => {
        this.pruneExpiredState();
        this.emitHealth();
        this.pruneVolumeWindows();
        this.checkQuoteStaleness();
      }, HEALTH_CHECK_INTERVAL_MS);
    }
  }

  private pruneVolumeWindows(): void {
    if (this.volumeWindows.size === 0) return;
    const now = Date.now();
    const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];
    for (const [id, window] of this.volumeWindows) {
      const before = window.totalContracts;
      const after = gateioPruneVolumeWindow(window, now);
      if (window.trades.length === 0) {
        this.volumeWindows.delete(id);
      }
      if (after !== before) {
        const inst = this.instrumentMap.get(id);
        const prev = this.quoteStore.get(id);
        if (inst != null && prev != null) {
          updates.push({
            exchangeSymbol: id,
            quote: applyGateioVolume(prev, after, inst.contractSize),
          });
        }
      }
    }
    if (updates.length > 0) this.emitQuoteUpdates(updates);
  }

  private async fetchTickerSnapshot(underlying: string): Promise<void> {
    try {
      const raw = await this.fetchGateioApi(GATEIO_OPTIONS_TICKERS, { underlying });
      const tickers = parseGateioTickers(raw);
      const now = Date.now();
      let merged = 0;

      for (const t of tickers) {
        const prev = this.quoteStore.get(t.name);
        if (prev == null) continue;
        this.quoteStore.set(t.name, mergeGateioRestTicker(prev, t, now));
        merged++;
      }
      log.info({ count: merged, underlying }, 'fetched tickers');
    } catch (err: unknown) {
      log.warn({ underlying, err: String(err) }, 'failed to fetch tickers');
    }
  }

  // ── WebSocket connection ──────────────────────────────────────

  protected async subscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    this.pruneExpiredState();

    const activeInstruments = this.filterActiveInstruments(instruments);
    if (activeInstruments.length === 0) return;

    await this.ensureConnected();

    const underlyingName = `${underlying}_USDT`;
    const contracts = activeInstruments.map((i) => i.exchangeSymbol);
    const frames = buildGateioSubscribeFrames(this.subscriptions, contracts, underlyingName, nowSeconds);
    this.sendFrames(frames);

    log.info({ count: contracts.length, underlying: underlyingName }, 'subscribed to contracts');
  }

  protected override async unsubscribeChain(
    underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    this.pruneExpiredState();

    const activeInstruments = this.filterActiveInstruments(instruments);
    if (!this.wsClient?.isConnected || activeInstruments.length === 0) return;

    const underlyingName = `${underlying}_USDT`;
    const contracts = activeInstruments.map((i) => i.exchangeSymbol);
    const frames = buildGateioUnsubscribeFrames(
      this.subscriptions,
      contracts,
      underlyingName,
      nowSeconds,
    );
    this.sendFrames(frames);
  }

  protected async unsubscribeAll(): Promise<void> {
    if (!this.wsClient?.isConnected) return;

    const grouped = new Map<string, string[]>();
    for (const [underlying, set] of this.subscriptions.contractsByUnderlying) {
      grouped.set(underlying, [...set]);
    }

    for (const [underlying, contracts] of grouped) {
      if (contracts.length === 0) continue;
      const frames = buildGateioUnsubscribeFrames(
        this.subscriptions,
        contracts,
        underlying,
        nowSeconds,
      );
      this.sendFrames(frames);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.wsClient?.isConnected) return;
    await this.connectWs();
  }

  private connectWs(): Promise<void> {
    if (this.connectingPromise != null) return this.connectingPromise;

    if (this.wsClient == null) {
      this.wsClient = new TopicWsClient(GATEIO_OPTIONS_WS_URL, 'gateio-ws', {
        pingIntervalMs: GATEIO_PING_INTERVAL_MS,
        pingMessage: () => ({ time: nowSeconds(), channel: 'options.ping' }),
        onStatusChange: (state) => {
          this.emitStatus(
            state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting',
          );
        },
        getReplayMessages: () => {
          this.pruneExpiredState();
          const frames = buildGateioReplayFrames(this.subscriptions, nowSeconds);
          return frames.map((f) => f as unknown as Record<string, unknown>);
        },
        onMessage: (raw) => {
          this.handleRawMessage(raw);
        },
      });
    }

    this.connectingPromise = this.wsClient.connect().finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  // ── WS message handling ───────────────────────────────────────

  private handleRawMessage(raw: WebSocket.RawData): void {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      log.debug('malformed WS frame');
      return;
    }

    const msg = parseGateioWsMessage(json);

    switch (msg.kind) {
      case 'contract_ticker': {
        const id = msg.data.name;
        if (!this.instrumentMap.has(id)) return;
        const prev = this.quoteStore.get(id) ?? this.emptyQuote();
        const quote = mergeGateioWsContractTicker(prev, msg.data, Date.now());
        this.lastUpdateAt = quote.timestamp;
        this.emitQuoteUpdate(id, quote);
        return;
      }
      case 'trade': {
        const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];
        const now = Date.now();
        for (const trade of msg.data) {
          const id = trade.contract;
          const inst = this.instrumentMap.get(id);
          if (inst == null) continue;
          const prev = this.quoteStore.get(id) ?? this.emptyQuote();
          const timestampMs = trade.create_time_ms ?? trade.create_time * 1000;

          let window = this.volumeWindows.get(id);
          if (window == null) {
            window = createGateioVolumeWindow();
            this.volumeWindows.set(id, window);
          }
          const volumeContracts = gateioRecordTrade(
            window,
            { tsMs: timestampMs, size: trade.size },
            now,
          );

          const quote = mergeGateioTrade(
            prev,
            { price: trade.price, timestampMs },
            { volumeContracts, contractSize: inst.contractSize },
          );
          this.lastUpdateAt = quote.timestamp;
          updates.push({ exchangeSymbol: id, quote });
        }
        if (updates.length > 0) this.emitQuoteUpdates(updates);
        return;
      }
      case 'underlying_ticker': {
        const underlyingName = msg.data.name;
        const indexPrice = msg.data.index_price ?? null;
        if (indexPrice == null) return;

        const bucket = this.instrumentsByUnderlyingName.get(underlyingName);
        if (bucket == null || bucket.length === 0) return;

        const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];
        const now = Date.now();
        for (const inst of bucket) {
          const prev = this.quoteStore.get(inst.exchangeSymbol) ?? this.emptyQuote();
          const quote = mergeGateioUnderlyingTicker(prev, indexPrice, now);
          updates.push({ exchangeSymbol: inst.exchangeSymbol, quote });
        }
        if (updates.length > 0) {
          this.lastUpdateAt = now;
          this.emitQuoteUpdates(updates);
        }
        return;
      }
      case 'order_book_update': {
        return;
      }
      case 'error': {
        const err: GateioWsError = { at: Date.now() };
        if (msg.code !== undefined) err.code = msg.code;
        if (msg.message !== undefined) err.message = msg.message;
        this.lastWsError = err;
        this.logWsError(msg.channel, msg.code, msg.message);
        this.emitHealth();
        return;
      }
      case 'ack':
      case 'pong':
      case 'ignore': {
        return;
      }
    }
  }

  private emitHealth(): void {
    const health = deriveGateioHealth({
      restOk: this.restOk,
      restLatencyMs: this.restLatencyMs,
      lastWsError: this.lastWsError,
      lastUpdateAt: this.lastUpdateAt,
      trackedContracts: this.subscriptions.contracts.size,
    });
    this.emitStatus(health.state, health.reason);
  }

  private checkQuoteStaleness(now = Date.now()): void {
    if (this.subscriptions.contracts.size === 0 || this.lastUpdateAt <= 0) return;

    const staleMs = now - this.lastUpdateAt;
    if (staleMs < GATEIO_QUOTE_STALE_RECONNECT_MS) return;
    if (this.lastUpdateAt <= this.lastQuoteStaleReconnectAt) return;

    this.lastQuoteStaleReconnectAt = now;
    log.error(
      {
        trackedContracts: this.subscriptions.contracts.size,
        staleMs,
      },
      'gateio quotes stale, forcing reconnect',
    );
    this.emitStatus('reconnecting', `gateio quotes stale for ${Math.round(staleMs / 1000)}s`);
    this.wsClient?.terminate();
  }

  private filterActiveInstruments(instruments: CachedInstrument[], now = Date.now()): CachedInstrument[] {
    return instruments.filter((instrument) => !this.isExpiredInstrument(instrument, now));
  }

  private pruneExpiredState(now = Date.now()): void {
    const expiredInstruments = this.sweepExpiredInstruments(now);
    if (expiredInstruments.length === 0) return;

    const expiredSymbols = new Set(expiredInstruments.map((instrument) => instrument.exchangeSymbol));

    for (const symbol of expiredSymbols) {
      this.volumeWindows.delete(symbol);
    }

    for (const [underlying, instruments] of this.instrumentsByUnderlyingName) {
      const activeInstruments = instruments.filter((instrument) => !expiredSymbols.has(instrument.exchangeSymbol));
      if (activeInstruments.length > 0) {
        this.instrumentsByUnderlyingName.set(underlying, activeInstruments);
        continue;
      }
      this.instrumentsByUnderlyingName.delete(underlying);
    }

    pruneGateioSubscriptionState(this.subscriptions, (contract) => !expiredSymbols.has(contract));

    log.info({ expiredContracts: expiredSymbols.size }, 'pruned expired contracts from gateio state');
  }

  private logWsError(channel: string, code?: number, message?: string): void {
    const key = `${channel}:${code ?? ''}:${message ?? ''}`;
    const now = Date.now();
    if (this.lastWsErrorLogKey === key && now - this.lastWsErrorLogAt < GATEIO_WS_ERROR_LOG_COOLDOWN_MS) {
      return;
    }
    this.lastWsErrorLogKey = key;
    this.lastWsErrorLogAt = now;
    log.warn({ channel, code, message }, 'ws error');
  }

  // ── helpers ───────────────────────────────────────────────────

  private async fetchGateioApi(
    path: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(path, GATEIO_REST_BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, { signal: AbortSignal.timeout(GATEIO_REST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Gate.io ${path} returned ${res.status}`);
    return res.json();
  }

  private sendFrames(frames: GateioFrame[]): void {
    if (frames.length === 0 || !this.wsClient?.isConnected) return;
    for (const frame of frames) {
      this.wsClient.send(frame as unknown as Record<string, unknown>);
    }
  }

  override async dispose(): Promise<void> {
    if (this.healthTimer != null) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.volumeWindows.clear();
    await this.unsubscribeAll();
    await this.wsClient?.disconnect();
    this.wsClient = null;
  }
}
