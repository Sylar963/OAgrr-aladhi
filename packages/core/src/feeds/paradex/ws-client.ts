import type WebSocket from 'ws';
import type { VenueConnectionState } from '../../core/types.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import { PARADEX_WS_URL } from '../shared/endpoints.js';
import {
  DEFAULT_SURFACE_COVERAGE,
  SdkBaseAdapter,
  type CachedInstrument,
} from '../shared/sdk-base.js';
import { PacedSender, TopicShardAllocator, aggregateShardState } from '../shared/topic-shards.js';
import { TopicWsClient } from '../shared/topic-ws-client.js';
import { parseParadexRpcResponse, parseParadexSummary } from './codec.js';
import { deriveParadexHealth } from './health.js';
import {
  PARADEX_SHARD_CAPACITY,
  PARADEX_SUBSCRIBE_FRAMES_PER_TICK,
  PARADEX_SUBSCRIBE_TICK_MS,
  PARADEX_SUBSCRIPTION_CAP_ERROR,
  paradexSummaryChannel,
  paradexSymbolFromChannel,
} from './planner.js';
import { fetchParadexMarkets, fetchParadexServerTime, fetchParadexSummaryAll } from './rest.js';
import { decodeParadexMarketSummarySbe } from './sbe.js';
import { buildParadexQuote, paradexInstrumentDetails } from './state.js';

const log = feedLogger('paradex');
const INSTRUMENT_REFRESH_INTERVAL_MS = 10 * 60_000;
const HEALTH_CHECK_INTERVAL_MS = 60_000;

type ParadexControlFrame = { method: 'subscribe' | 'unsubscribe'; channel: string };

interface ParadexShard {
  client: TopicWsClient;
  sender: PacedSender<ParadexControlFrame>;
  pendingRequests: Map<number, ParadexControlFrame>;
  state: VenueConnectionState;
}

/**
 * Paradex options adapter: per-market `markets_summary.{symbol}` channels over
 * sharded sockets (≤200 subscriptions each), SBE-encoded market data, JSON
 * control replies. Paradex pings every ~30s and `ws` answers automatically, so
 * there is no app-level heartbeat. Symbols outside the live set keep a REST
 * snapshot refreshed on the health cadence. USDC-settled, linear, IV in fractions.
 */
export class ParadexWsAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'paradex';

  private readonly shards: ParadexShard[] = [];
  private readonly shardAllocator = new TopicShardAllocator(PARADEX_SHARD_CAPACITY);
  private nextRequestId = 1;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  protected override surfaceCoverage = DEFAULT_SURFACE_COVERAGE;

  protected initClients(): void {}

  protected override getFeedConnectionSnapshot() {
    if (this.shards.length === 0) return null;
    let connected = true;
    let lastActivityAt = Number.POSITIVE_INFINITY;
    for (const { client } of this.shards) {
      connected &&= client.isConnected;
      lastActivityAt = Math.min(lastActivityAt, client.lastActivityAtMs || client.connectedAtMs);
    }
    return { connected, lastActivityAt };
  }

  protected override restartFeedFromWatchdog(): void {
    for (const { client } of this.shards) client.terminate();
  }

  private get wsConnected(): boolean {
    return this.shards.length > 0 && this.shards.every(({ client }) => client.isConnected);
  }

  // ─── instrument loading ───────────────────────────────────────

  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    const markets = await fetchParadexMarkets();
    const instruments: CachedInstrument[] = [];
    for (const market of markets) {
      const inst = this.parseInstrument(market);
      if (inst) instruments.push(inst);
    }
    log.info({ count: instruments.length }, 'loaded paradex option instruments');

    const optionSymbols = new Set(instruments.map((i) => i.exchangeSymbol));
    await this.seedQuotes(optionSymbols);

    this.refreshTimer = setInterval(
      () => void this.refreshInstruments(),
      INSTRUMENT_REFRESH_INTERVAL_MS,
    );
    this.healthTimer = setInterval(() => void this.refreshHealth(), HEALTH_CHECK_INTERVAL_MS);
    void this.refreshHealth();

    return instruments;
  }

  private parseInstrument(market: unknown): CachedInstrument | null {
    const parsed = market as Parameters<typeof paradexInstrumentDetails>[0];
    const d = paradexInstrumentDetails(parsed);
    if (d == null) return null;

    const expiry = this.parseExpiry(d.expiryRaw);
    return {
      symbol: this.buildCanonicalSymbol(d.base, d.settle, expiry, d.strike, d.right),
      exchangeSymbol: parsed.symbol,
      base: d.base,
      quote: 'USD',
      settle: d.settle,
      expiry,
      expirationTimestamp: d.expirationTimestampMs,
      strike: d.strike,
      right: d.right,
      inverse: false,
      contractSize: 1,
      contractValueCurrency: d.base,
      tickSize: this.safeNum(d.tickRaw),
      minQty: this.safeNum(d.stepRaw),
      makerFee: this.safeNum(d.makerFeeRaw),
      takerFee: this.safeNum(d.takerFeeRaw),
    };
  }

  private async seedQuotes(symbols: Set<string>): Promise<void> {
    if (symbols.size === 0) return;
    try {
      const summaries = await fetchParadexSummaryAll();
      let n = 0;
      for (const s of summaries) {
        if (!symbols.has(s.symbol)) continue;
        this.quoteStore.set(
          s.symbol,
          buildParadexQuote(
            s,
            (v) => this.safeNum(v),
            (v) => this.positiveOrNull(v),
          ),
        );
        n++;
      }
      log.info({ count: n }, 'seeded paradex quotes from REST summary');
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'paradex summary seed failed');
    }
  }

  // ─── WebSocket subscriptions ──────────────────────────────────

  protected async subscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    const channels = instruments.map((inst) => paradexSummaryChannel(inst.exchangeSymbol));
    const groups = this.shardAllocator.assign(channels);

    for (const [index, shardChannels] of groups) {
      const shard = this.shard(index);
      if (shard.client.isConnected) {
        shard.sender.enqueue(shardChannels.map((channel) => ({ method: 'subscribe', channel })));
        continue;
      }
      // A connecting shard subscribes its whole allocation from onOpen.
      void shard.client.connect().catch((err: unknown) => {
        log.warn({ shard: index, err: String(err) }, 'paradex shard connect failed; retrying');
      });
    }
  }

  protected override async unsubscribeChain(
    _underlying: string,
    _expiry: string,
    instruments: CachedInstrument[],
  ): Promise<void> {
    this.releaseChannels(instruments.map((inst) => paradexSummaryChannel(inst.exchangeSymbol)));
  }

  protected async unsubscribeAll(): Promise<void> {
    const all: string[] = [];
    for (let index = 0; index < this.shardAllocator.shardCount; index++) {
      all.push(...this.shardAllocator.topicsFor(index));
    }
    this.releaseChannels(all);
  }

  private releaseChannels(channels: string[]): void {
    for (const [index, released] of this.shardAllocator.release(channels)) {
      const shard = this.shards[index];
      if (shard == null) continue;
      const releasedSet = new Set(released);
      shard.sender.remove(
        (frame) => frame.method === 'subscribe' && releasedSet.has(frame.channel),
      );
      if (!shard.client.isConnected) continue;
      shard.sender.enqueue(released.map((channel) => ({ method: 'unsubscribe', channel })));
    }
  }

  private shard(index: number): ParadexShard {
    const existing = this.shards[index];
    if (existing) return existing;

    const pendingRequests = new Map<number, ParadexControlFrame>();
    const client: TopicWsClient = new TopicWsClient(
      PARADEX_WS_URL,
      index === 0 ? 'paradex-ws' : `paradex-ws-${index}`,
      {
        skipUtf8Validation: true,
        onStatusChange: (state) => {
          shard.state =
            state === 'connected' ? 'connected' : state === 'down' ? 'down' : 'reconnecting';
          this.emitStatus(aggregateShardState(this.shards.map((s) => s.state)));
        },
        onOpen: () => {
          shard.sender.clear();
          pendingRequests.clear();
          shard.sender.enqueue(
            this.shardAllocator
              .topicsFor(index)
              .map((channel) => ({ method: 'subscribe' as const, channel })),
          );
        },
        onClose: () => {
          shard.sender.clear();
          pendingRequests.clear();
        },
        onMessage: (raw) => this.handleShardMessage(index, raw),
      },
    );
    const sender = new PacedSender<ParadexControlFrame>(
      (frame) => {
        const id = this.nextRequestId++;
        pendingRequests.set(id, frame);
        client.send({ jsonrpc: '2.0', id, method: frame.method, params: { channel: frame.channel } });
      },
      PARADEX_SUBSCRIBE_FRAMES_PER_TICK,
      PARADEX_SUBSCRIBE_TICK_MS,
    );
    const shard: ParadexShard = { client, sender, pendingRequests, state: 'down' };
    this.shards[index] = shard;
    return shard;
  }

  // ─── WS message handlers ─────────────────────────────────────

  private handleShardMessage(index: number, raw: WebSocket.RawData): void {
    const summary = decodeParadexMarketSummarySbe(raw);
    if (summary != null) {
      this.handleSummary(summary);
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const reply = parseParadexRpcResponse(json);
    if (reply?.id == null) return;

    const shard = this.shards[index];
    const frame = shard?.pendingRequests.get(reply.id);
    if (shard == null || frame == null) return;
    shard.pendingRequests.delete(reply.id);
    if (reply.error == null || frame.method !== 'subscribe') return;

    // A rejected channel must leave the allocation, or every reconnect would
    // replay it and the shard would keep counting it against the 200 cap.
    this.shardAllocator.release([frame.channel]);
    log.warn(
      {
        shard: index,
        symbol: paradexSymbolFromChannel(frame.channel),
        code: reply.error.code,
        err: reply.error.message,
        capHit: reply.error.code === PARADEX_SUBSCRIPTION_CAP_ERROR,
      },
      'paradex subscribe rejected',
    );
  }

  private handleSummary(data: unknown): void {
    const summary = parseParadexSummary(data);
    if (summary == null) return;
    if (!this.instrumentMap.has(summary.symbol)) return; // ignore perps/spot + unknown
    const quote = buildParadexQuote(
      summary,
      (v) => this.safeNum(v),
      (v) => this.positiveOrNull(v),
    );
    this.emitQuoteUpdate(summary.symbol, quote);
  }

  private async refreshInstruments(): Promise<void> {
    try {
      const markets = await fetchParadexMarkets();
      let added = 0;
      for (const market of markets) {
        const inst = this.parseInstrument(market);
        if (!inst || this.instrumentMap.has(inst.exchangeSymbol)) continue;
        this.instruments.push(inst);
        this.instrumentMap.set(inst.exchangeSymbol, inst);
        this.symbolIndex.set(inst.symbol, inst.exchangeSymbol);
        added++;
      }
      if (added > 0) log.info({ added }, 'paradex new instruments from refresh');

      const removed = this.sweepExpiredInstruments();
      if (removed.length > 0) {
        this.releaseChannels(removed.map((inst) => paradexSummaryChannel(inst.exchangeSymbol)));
        log.info({ count: removed.length }, 'paradex expired instruments removed');
      }
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'paradex instrument refresh failed');
    }
  }

  private async refreshHealth(): Promise<void> {
    const serverTime = await fetchParadexServerTime();
    const health = deriveParadexHealth({ serverTime, wsConnected: this.wsConnected });
    this.emitStatus(health.status, health.message);

    // Live channels only cover pinned/open chains; everything else (and any shard
    // that is down) keeps a REST snapshot so the 5-minute freshness gate holds.
    const restSymbols = new Set<string>();
    for (const instrument of this.instruments) {
      const shardIndex = this.shardAllocator.shardOf(paradexSummaryChannel(instrument.exchangeSymbol));
      const live = shardIndex != null && this.shards[shardIndex]?.client.isConnected === true;
      if (!live) restSymbols.add(instrument.exchangeSymbol);
    }
    await this.seedQuotes(restSymbols);
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
    for (const shard of this.shards) shard.sender.clear();
    await Promise.all(this.shards.map(({ client }) => client.disconnect()));
    this.shards.length = 0;
    this.shardAllocator.clear();
  }
}
