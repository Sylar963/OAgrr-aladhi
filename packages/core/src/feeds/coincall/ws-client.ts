import {
  COINCALL_MARKET_WS_URL,
  COINCALL_REST_BASE_URL,
  COINCALL_INSTRUMENTS,
  COINCALL_OPTION_CHAIN,
  COINCALL_CONFIG,
  COINCALL_TIME,
} from '../shared/endpoints.js';
import { SdkBaseAdapter, type CachedInstrument, type LiveQuote } from '../shared/sdk-base.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import {
  parseCoincallInstrument,
  parseCoincallMarkPrice,
  parseCoincallOptionChain,
  parseCoincallPublicConfig,
  parseCoincallTime,
  isCoincallWsSuccess,
} from './codec.js';
import { deriveCoincallHealth } from './health.js';
import {
  buildCoincallInitialChannels,
  buildCoincallPricingChannel,
  confirmCoincallSubscribedChannels,
  createCoincallSubscriptionState,
  removeCoincallTrackedChannels,
  resetCoincallSubscriptionState,
  rollbackCoincallPendingChannels,
  trackCoincallChannels,
} from './planner.js';
import {
  buildCoincallInstrument,
  buildCoincallMarkPriceQuote,
  mergeCoincallTicker,
  COINCALL_DEFAULT_MAKER_FEE,
  COINCALL_DEFAULT_TAKER_FEE,
} from './state.js';

const log = feedLogger('coincall');

const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

export class CoincallWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'coincall';

  protected override eagerExpiryCount = 3;

  private wsClient: WebSocket | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private msgId = 0;
  private hasConnectedOnce = false;
  private readonly subscriptions = createCoincallSubscriptionState();
  private readonly pendingSubscribeById = new Map<number, string[]>();
  private optionConfig: Record<string, { settle: string; contractSize: number }> = {};

  protected initClients(): void {}

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const instruments: CachedInstrument[] = [];

    const configRaw = await this.fetchApi(COINCALL_CONFIG);
    const config = parseCoincallPublicConfig(configRaw);

    if (config?.optionConfig) {
      for (const [symbol, cfg] of Object.entries(config.optionConfig)) {
        this.optionConfig[symbol] = {
          settle: cfg.settle,
          contractSize: cfg.multiplier,
        };
      }
    }

    const underlyings = ['BTC', 'ETH'];
    for (const underlying of underlyings) {
      try {
        const response = await this.fetchApi(`${COINCALL_INSTRUMENTS}/${underlying}`);
        if (Array.isArray(response)) {
          for (const item of response) {
            const parsed = parseCoincallInstrument(item);
            if (!parsed) continue;

            const cfg = this.optionConfig[parsed.baseCurrency];
            const inst = buildCoincallInstrument(
              {
                symbolName: parsed.symbolName,
                baseCurrency: parsed.baseCurrency,
                strike: parsed.strike,
                expirationTimestamp: parsed.expirationTimestamp,
                isActive: parsed.isActive,
                minQty: parsed.minQty,
                tickSize: parsed.tickSize,
              },
              cfg ?? null,
              (base, settle, expiry, strike, right) =>
                this.buildCanonicalSymbol(base, settle, expiry, strike, right),
            );
            if (inst) instruments.push(inst);
          }
        }
      } catch (err) {
        log.warn({ underlying, err: String(err) }, 'failed to load instruments');
      }
    }

    log.info({ count: instruments.length }, 'loaded option instruments');

    await this.connectAndSubscribe(instruments);
    await this.waitForFirstData();

    this.healthCheckTimer = setInterval(() => {
      void this.runHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
    void this.runHealthCheck();

    return instruments;
  }

  private waitForFirstData(): Promise<void> {
    const target = new Set(
      [...this.subscriptions.subscribedChannels, ...this.subscriptions.pendingSubscribeChannels]
        .filter((ch) => ch.startsWith('pricing.'))
        .map((ch) => ch.split('.')[1]!),
    ).size;
    const seen = new Set<string>();

    return new Promise((resolve) => {
      const check = setInterval(() => {
        for (const key of this.quoteStore.keys()) {
          seen.add(key.split('-')[0]!.toUpperCase());
        }
        if (seen.size >= target) {
          clearInterval(check);
          log.info(
            { quotes: this.quoteStore.size, underlyings: seen.size },
            'initial data received',
          );
          resolve();
        }
      }, 200);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 10_000);
    });
  }

  private async connectAndSubscribe(instruments: CachedInstrument[]): Promise<void> {
    const channels = buildCoincallInitialChannels(instruments);
    await this.connectWs();
    const newChannels = trackCoincallChannels(this.subscriptions, channels);
    this.sendSubscribe(newChannels);
  }

  private connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wsClient != null) {
        resolve();
        return;
      }

      this.wsClient = new WebSocket(COINCALL_MARKET_WS_URL);

      this.wsClient.onopen = () => {
        log.info('websocket connected');
        if (this.hasConnectedOnce) {
          void this.refreshInstruments();
        }
        this.hasConnectedOnce = true;
        resolve();
      };

      this.wsClient.onmessage = (event) => {
        try {
          this.handleWsMessage(JSON.parse(event.data));
        } catch (error: unknown) {
          log.debug({ err: String(error) }, 'malformed WS frame');
        }
      };

      this.wsClient.onclose = () => {
        log.info('websocket disconnected');
        this.emitStatus('reconnecting');
        setTimeout(() => {
          if (this.wsClient?.readyState === WebSocket.CLOSED) {
            this.wsClient = null;
            void this.connectWs();
          }
        }, 1000);
      };

      this.wsClient.onerror = (error) => {
        log.error({ err: String(error) }, 'websocket error');
        reject(error);
      };
    });
  }

  private sendSubscribe(channels: string[]): void {
    if (channels.length === 0 || !this.wsClient) return;

    const id = ++this.msgId;
    this.pendingSubscribeById.set(id, channels);
    this.wsClient.send(
      JSON.stringify({
        type: 'subscribe',
        channels,
        id,
      }),
    );
    log.info({ count: channels.length, id }, 'requested channel subscribe');
  }

  private handleWsMessage(msg: unknown): void {
    const id = typeof (msg as { id?: number })['id'] === 'number' ? (msg as { id: number })['id'] : null;

    if (id != null) {
      const pending = this.pendingSubscribeById.get(id);
      if (pending && isCoincallWsSuccess(msg)) {
        confirmCoincallSubscribedChannels(this.subscriptions, pending);
        this.pendingSubscribeById.delete(id);
      } else if (pending) {
        rollbackCoincallPendingChannels(this.subscriptions, pending);
        this.pendingSubscribeById.delete(id);
        log.warn({ id, msg }, 'subscribe rejected');
      }
      return;
    }

    const channel = (msg as { channel?: string })['channel'];
    const data = (msg as { data?: unknown })['data'];

    if (!channel || !data) return;

    if (channel.startsWith('pricing.')) {
      const underlying = channel.split('.')[1]!;
      this.handlePricingUpdate(underlying, data);
    }
  }

  private handlePricingUpdate(underlying: string, data: unknown): void {
    const updates: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];

    if (Array.isArray(data)) {
      for (const item of data) {
        const parsed = parseCoincallMarkPrice(item);
        if (!parsed) continue;

        const exchangeSymbol = parsed.symbol;
        const previous = this.quoteStore.get(exchangeSymbol);
        const quote = buildCoincallMarkPriceQuote(
          parsed,
          previous,
          (val) => this.positiveOrNull(val),
          (val) => this.safeNum(val),
        );

        if (!this.instrumentMap.has(exchangeSymbol)) {
          this.quoteStore.set(exchangeSymbol, quote);
          continue;
        }

        updates.push({ exchangeSymbol, quote });
      }
    }

    if (updates.length > 0) {
      this.emitQuoteUpdates(updates);
    }
  }

  protected async subscribeChain(
    underlying: string,
    _expiry: string,
    _instruments: CachedInstrument[],
  ): Promise<void> {
    const channel = buildCoincallPricingChannel(underlying);
    const newChannels = trackCoincallChannels(this.subscriptions, [channel]);

    if (newChannels.length > 0) {
      this.sendSubscribe(newChannels);
    }
  }

  protected override async unsubscribeChain(
    underlying: string,
    _expiry: string,
    _instruments: CachedInstrument[],
  ): Promise<void> {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) return;

    const channel = buildCoincallPricingChannel(underlying);
    if (this.activeRequestsForUnderlying(underlying) === 0) {
      this.wsClient.send(
        JSON.stringify({
          type: 'unsubscribe',
          channels: [channel],
          id: ++this.msgId,
        }),
      );
      removeCoincallTrackedChannels(this.subscriptions, [channel]);
    }
  }

  protected async unsubscribeAll(): Promise<void> {
    const channels = [...this.subscriptions.subscribedChannels];
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN && channels.length > 0) {
      this.wsClient.send(
        JSON.stringify({
          type: 'unsubscribe',
          channels,
          id: ++this.msgId,
        }),
      );
    }
    this.pendingSubscribeById.clear();
    resetCoincallSubscriptionState(this.subscriptions);
  }

  private async refreshInstruments(): Promise<void> {
    this.sweepExpiredState();
  }

  private async runHealthCheck(): Promise<void> {
    try {
      const [timeRaw, configRaw] = await Promise.all([
        this.fetchApi(COINCALL_TIME),
        this.fetchApi(COINCALL_CONFIG),
      ]);

      const health = deriveCoincallHealth(
        parseCoincallTime(timeRaw),
        parseCoincallPublicConfig(configRaw),
      );
      this.emitStatus(health.status, health.message);
    } catch (error: unknown) {
      const health = deriveCoincallHealth(null, null, error);
      this.emitStatus(health.status, health.message);
    }
  }

  private async fetchApi(path: string): Promise<unknown> {
    const res = await fetch(`${COINCALL_REST_BASE_URL}${path}`);
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    const data = await res.json() as { code?: number; msg?: string; data?: unknown };
    if (data.code !== 0 && data.code !== undefined) {
      throw new Error(data.msg ?? 'API error');
    }
    return data.data ?? data;
  }

  private sweepExpiredState(): void {
    const removed = this.sweepExpiredInstruments();
    if (removed.length === 0) return;

    removeCoincallTrackedChannels(
      this.subscriptions,
      buildCoincallInitialChannels(removed),
    );
    log.info({ count: removed.length }, 'removed expired instruments');
  }

  override async dispose(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    await this.unsubscribeAll();
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.hasConnectedOnce = false;
  }
}