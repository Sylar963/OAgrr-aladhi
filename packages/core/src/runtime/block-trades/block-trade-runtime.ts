import { z } from 'zod';
import {
  BINANCE_BLOCK_TRADES,
  BINANCE_REST_BASE_URL,
  BYBIT_RFQ_WS_URL,
  DERIBIT_GET_BLOCK_RFQ_TRADES,
  DERIBIT_REST_BASE_URL,
  DERIBIT_WS_URL,
  DERIVE_GET_TRADE_HISTORY,
  DERIVE_REST_BASE_URL,
  OKX_REST_BASE_URL,
  OKX_RFQ_PUBLIC_TRADES,
} from '../../feeds/shared/endpoints.js';
import { TopicWsClient } from '../../feeds/shared/topic-ws-client.js';
import { computeBlockTradeAmounts } from '../../trade-persistence.js';
import type { VenueId } from '../../types/common.js';
import { feedLogger } from '../../utils/logger.js';
import { backoffDelay } from '../../utils/reconnect.js';
import {
  DERIBIT_OTC_TAPE_CHANNEL,
  DeribitOtcBlockAssembler,
  fetchDeribitOtcSeed,
  parseDeribitOtcLegs,
} from './deribit-otc.js';
import { createBlockVenueState, mergeBlockVenueState } from './health.js';
import { areOptionLegs, deriveStrategy, extractUnderlying, isOptionInstrument } from './instruments.js';
import { BLOCK_TRADE_RUNTIME_BUFFER_SIZE, insertBlockTrades } from './retention.js';
import type {
  BlockTradeEvent,
  BlockTradeRuntimeHealth,
  BlockVenuePoller,
  BlockVenueState,
  BlockVenueStream,
  BlockVenueStreamHandlers,
} from './types.js';

const log = feedLogger('block-trade-runtime');
const RATE_LIMIT_COOLDOWN_MS = 90 * 1000;
const DERIBIT_BLOCK_KEEPALIVE_MS = 25_000;
const BYBIT_BLOCK_KEEPALIVE_MS = 20_000;
// Both block sockets answer their keepalive, so a few missed replies means the connection is dead.
const BLOCK_STREAM_IDLE_TIMEOUT_MS = 90_000;

// ── Runtime configuration ─────────────────────────────────────
const DERIBIT_SEED_COUNT = 250;
// Deribit docs say max 1000 but the API enforces [10, 50].
const DERIBIT_SEED_PAGE_SIZE = 50;
const DERIBIT_SEED_RETRIES = 5;
const DERIVE_INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DERIVE_POLL_OVERLAP_MS = 60_000;
const DERIVE_PAGE_SIZE = 1_000;
const MAX_DERIVE_PAGES_PER_POLL = 25;

/**
 * Aggregates block/RFQ trades across all venues.
 * Deribit + Bybit via WebSocket (real-time), OKX + Binance + Derive via REST polling.
 * Deribit also streams OTC blocks (Paradigm, bilateral) off its public option tape.
 */
export class BlockTradeRuntime {
  private buffer: BlockTradeEvent[] = [];
  private seenTradeTimestamps = new Map<string, number>();
  private streams: BlockVenueStream[] = [];
  private pollTimers: ReturnType<typeof setInterval>[] = [];
  private listeners = new Set<(trade: BlockTradeEvent) => void>();
  private venueState = new Map<VenueId, BlockVenueState>();

  async start(): Promise<void> {
    const wsStreams = [deribitBlockStream(), bybitBlockStream()];
    const pollers = [okxBlockPoller(), binanceBlockPoller(), deriveBlockPoller()];

    for (const stream of wsStreams) {
      this.venueState.set(stream.venue, createBlockVenueState('ws', null));
      stream.connect({
        onTrades: (trades) => {
          this.recordPollResult(stream.venue, trades.length);
          this.pushTrades(trades);
        },
        onConnected: () => {
          this.updateVenueState(stream.venue, { connected: true, lastStatusAt: Date.now() });
        },
        onDisconnected: () => {
          this.updateVenueState(stream.venue, { connected: false, lastStatusAt: Date.now() });
        },
        onError: () => {
          this.updateVenueState(stream.venue, {
            errors: (this.venueState.get(stream.venue)?.errors ?? 0) + 1,
            lastStatusAt: Date.now(),
          });
        },
        onReconnect: () => {
          this.updateVenueState(stream.venue, {
            reconnects: (this.venueState.get(stream.venue)?.reconnects ?? 0) + 1,
            lastStatusAt: Date.now(),
          });
        },
      });
      this.streams.push(stream);
    }

    for (const poller of pollers) {
      this.venueState.set(poller.venue, createBlockVenueState('poll', poller.limit ?? null));
      void this.runPoller(poller, true);
      const timer = setInterval(() => {
        void this.runPoller(poller, false);
      }, poller.intervalMs);
      this.pollTimers.push(timer);
    }

    log.info('block flow service started');
  }

  getTrades(underlying?: string): BlockTradeEvent[] {
    if (!underlying) return this.buffer;
    const upper = underlying.toUpperCase();
    return this.buffer.filter((t) => t.underlying === upper);
  }

  subscribe(listener: (trade: BlockTradeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getHealth(): BlockTradeRuntimeHealth[] {
    return Array.from(this.venueState.entries()).map(([venue, state]) => ({
      venue,
      transport: state.transport,
      connected: state.connected,
      lastSuccessAt: state.lastSuccessAt,
      lastTradeAt: state.lastTradeAt,
      lastStatusAt: state.lastStatusAt,
      lastPollCount: state.lastPollCount,
      pollLimit: state.pollLimit,
      hitLimitCount: state.hitLimitCount,
      reconnects: state.reconnects,
      errors: state.errors,
      bufferedTrades: this.buffer.filter((trade) => trade.venue === venue).length,
    }));
  }

  private async runPoller(poller: BlockVenuePoller, initial: boolean): Promise<void> {
    try {
      const trades = await poller.poll();
      const insertedCount = this.pushTrades(trades);
      this.recordPollResult(poller.venue, trades.length, {
        insertedCount,
        limit: poller.limit ?? null,
        initial,
      });
    } catch (err) {
      this.updateVenueState(poller.venue, {
        errors: (this.venueState.get(poller.venue)?.errors ?? 0) + 1,
        lastStatusAt: Date.now(),
      });
      log.warn(
        { venue: poller.venue, err: String(err) },
        initial ? 'initial block trade poll failed' : 'block trade poll failed',
      );
    }
  }

  private updateVenueState(venue: VenueId, patch: Partial<BlockVenueState>): void {
    const current = this.venueState.get(venue);
    if (!current) return;
    this.venueState.set(venue, mergeBlockVenueState(current, patch));
  }

  private recordPollResult(
    venue: VenueId,
    tradeCount: number,
    poll: { insertedCount: number; limit: number | null; initial: boolean } | null = null,
  ): void {
    const now = Date.now();
    const state = this.venueState.get(venue);
    const limit = poll?.limit ?? null;
    // Pollers re-fetch the newest `limit` rows every cycle, so a full page is normal. Trades
    // can only have been skipped when a full page shares nothing with what earlier polls saw.
    const possibleGap =
      poll != null &&
      !poll.initial &&
      limit != null &&
      tradeCount >= limit &&
      poll.insertedCount >= tradeCount;

    this.updateVenueState(venue, {
      connected: true,
      lastSuccessAt: now,
      lastStatusAt: now,
      lastPollCount: tradeCount,
      pollLimit: limit,
      hitLimitCount: (state?.hitLimitCount ?? 0) + (possibleGap ? 1 : 0),
    });

    if (possibleGap) {
      log.warn(
        { venue, count: tradeCount, limit },
        'block trade poll page had no overlap with the previous poll, trades may be missing',
      );
    }
  }

  private pushTrades(trades: BlockTradeEvent[]): number {
    const { inserted, latestByVenue } = insertBlockTrades(
      this.buffer,
      this.seenTradeTimestamps,
      trades,
      BLOCK_TRADE_RUNTIME_BUFFER_SIZE,
    );

    for (const [venue, timestamp] of latestByVenue) {
      this.updateVenueState(venue, { lastTradeAt: timestamp });
    }

    for (const trade of inserted) {
      for (const listener of this.listeners) {
        try {
          listener(trade);
        } catch (error) {
          log.warn(
            { err: String(error), venue: trade.venue, tradeId: trade.tradeId },
            'block trade listener failed',
          );
        }
      }
    }
    return inserted.length;
  }

  dispose(): void {
    for (const s of this.streams) s.dispose();
    this.streams = [];
    for (const t of this.pollTimers) clearInterval(t);
    this.pollTimers = [];
  }
}

// ── Helpers ───────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json() as Promise<unknown>;
}

// ── Deribit (WS real-time) ────────────────────────────────────

const DeribitBlockRfqSchema = z.object({
  id: z.number(),
  timestamp: z.number(),
  amount: z.number(),
  direction: z.enum(['buy', 'sell']),
  mark_price: z.number().optional(),
  combo_id: z.string().nullable().optional(),
  index_prices: z.record(z.string(), z.number()).optional(),
  legs: z.array(
    z.object({
      price: z.number(),
      direction: z.enum(['buy', 'sell']),
      instrument_name: z.string(),
      ratio: z.number(),
    }),
  ),
});

const DeribitBlockRfqResponseSchema = z.object({
  result: z
    .object({
      block_rfqs: z.array(DeribitBlockRfqSchema),
      continuation: z.string().nullable().optional(),
    })
    .optional(),
});

function mapDeribitBlockTrade(
  trade: z.infer<typeof DeribitBlockRfqSchema>,
): BlockTradeEvent | null {
  const instruments = trade.legs.map((leg) => leg.instrument_name);
  if (!areOptionLegs(instruments)) return null;

  const underlying = extractUnderlying(trade.legs[0]?.instrument_name ?? 'BTC');
  const indexPriceEntries = Object.entries(trade.index_prices ?? {});
  const indexPrice = indexPriceEntries[0]?.[1] ?? null;

  const blockTrade: BlockTradeEvent = {
    venue: 'deribit',
    source: 'rfq',
    tradeId: String(trade.id),
    exchangeEvidence: {
      rfqId: String(trade.id),
      ...(trade.combo_id ? { comboId: trade.combo_id } : {}),
      expectedLegCount: trade.legs.length,
      groupComplete: true,
    },
    timestamp: trade.timestamp,
    underlying,
    direction: trade.direction,
    strategy: deriveStrategy(trade.combo_id, trade.legs.length),
    legs: trade.legs.map((leg) => ({
      instrument: leg.instrument_name,
      direction: leg.direction,
      price: indexPrice != null ? leg.price * indexPrice : leg.price,
      size: trade.amount,
      ratio: leg.ratio,
    })),
    totalSize: trade.amount,
    notionalUsd: 0,
    indexPrice,
  };

  blockTrade.notionalUsd = computeBlockTradeAmounts(blockTrade, indexPrice).notionalUsd ?? 0;
  return blockTrade;
}

async function fetchDeribitSeedTrades(): Promise<BlockTradeEvent[]> {
  const trades: BlockTradeEvent[] = [];
  const seen = new Set<string>();
  let continuation: string | undefined;

  while (trades.length < DERIBIT_SEED_COUNT) {
    const params = new URLSearchParams({ currency: 'any', count: String(DERIBIT_SEED_PAGE_SIZE) });
    if (continuation) params.set('continuation', continuation);

    const json = await fetchJson(
      `${DERIBIT_REST_BASE_URL}${DERIBIT_GET_BLOCK_RFQ_TRADES}?${params}`,
    );
    const parsed = DeribitBlockRfqResponseSchema.safeParse(json);
    if (!parsed.success) break;

    const page = parsed.data.result?.block_rfqs ?? [];
    if (page.length === 0) break;

    for (const item of page) {
      const tradeId = String(item.id);
      if (seen.has(tradeId)) continue;
      seen.add(tradeId);
      const trade = mapDeribitBlockTrade(item);
      if (!trade) continue;
      trades.push(trade);
      if (trades.length >= DERIBIT_SEED_COUNT) break;
    }

    continuation = parsed.data.result?.continuation ?? undefined;
    if (!continuation) break;
  }

  return trades;
}

async function seedDeribitBlockTrades(): Promise<BlockTradeEvent[]> {
  for (let attempt = 0; attempt < DERIBIT_SEED_RETRIES; attempt++) {
    try {
      return await fetchDeribitSeedTrades();
    } catch (err) {
      log.warn(
        {
          venue: 'deribit',
          err: String(err),
          attempt: attempt + 1,
          retries: DERIBIT_SEED_RETRIES,
        },
        'block trade seed failed',
      );
      if (attempt < DERIBIT_SEED_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
      }
    }
  }
  return [];
}

interface TopicBlockStreamConfig {
  venue: VenueId;
  url: string;
  subscribeMessage: Record<string, unknown>;
  pingMessage: Record<string, unknown>;
  pingIntervalMs: number;
  /** `emit` delivers trades assembled after the frame, e.g. once a block's legs are complete. */
  parseFrame: (
    msg: Record<string, unknown>,
    emit: (trades: BlockTradeEvent[]) => void,
  ) => BlockTradeEvent[];
  seed?: () => Promise<BlockTradeEvent[]>;
  onDispose?: () => void;
}

function topicBlockStream(config: TopicBlockStreamConfig): BlockVenueStream {
  let client: TopicWsClient | null = null;

  return {
    venue: config.venue,
    connect(handlers) {
      if (client != null) return;
      client = new TopicWsClient(config.url, `block-trades:${config.venue}`, {
        rateLimitCooldownMs: RATE_LIMIT_COOLDOWN_MS,
        pingIntervalMs: config.pingIntervalMs,
        pingMessage: config.pingMessage,
        idleTimeoutMs: BLOCK_STREAM_IDLE_TIMEOUT_MS,
        getReplayMessages: () => [config.subscribeMessage],
        onStatusChange: (state) => {
          if (state !== 'connected') return;
          handlers.onConnected();
          log.info({ venue: config.venue }, 'block trade WS connected');
        },
        onMessage: (raw) => {
          try {
            const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
            const trades = config.parseFrame(msg, handlers.onTrades);
            if (trades.length > 0) handlers.onTrades(trades);
          } catch (err) {
            log.debug({ venue: config.venue, err: String(err) }, 'malformed WS frame');
          }
        },
        onClose: () => {
          handlers.onDisconnected();
          handlers.onReconnect();
        },
        onError: (err) => {
          handlers.onError();
          log.warn({ venue: config.venue, err: err.message }, 'block trade WS error');
        },
      });
      // Failures before open are retried by the client's own close→reconnect path.
      client.connect().catch(() => {});

      void config.seed?.().then((trades) => {
        if (trades.length > 0) handlers.onTrades(trades);
      });
    },
    dispose() {
      const current = client;
      client = null;
      void current?.disconnect();
      config.onDispose?.();
    },
  };
}

function parseDeribitBlockFrame(
  msg: Record<string, unknown>,
  otcAssembler: DeribitOtcBlockAssembler,
): BlockTradeEvent[] {
  if (msg['method'] !== 'subscription') return [];
  const params = msg['params'] as Record<string, unknown> | undefined;
  const data = params?.['data'];
  if (!data || typeof data !== 'object') return [];
  // Deribit pushes single block_rfq objects, not arrays
  const items: unknown[] = Array.isArray(data) ? data : [data];
  if (params?.['channel'] === DERIBIT_OTC_TAPE_CHANNEL) {
    return otcAssembler.push(parseDeribitOtcLegs(items));
  }
  const trades: BlockTradeEvent[] = [];
  for (const item of items) {
    const parsed = DeribitBlockRfqSchema.safeParse(item);
    if (!parsed.success) continue;
    const trade = mapDeribitBlockTrade(parsed.data);
    if (trade) trades.push(trade);
  }
  return trades;
}

function deribitBlockStream(): BlockVenueStream {
  let otcAssembler: DeribitOtcBlockAssembler | null = null;

  return topicBlockStream({
    venue: 'deribit',
    url: DERIBIT_WS_URL,
    subscribeMessage: {
      jsonrpc: '2.0',
      id: 1,
      method: 'public/subscribe',
      params: { channels: ['block_rfq.trades.any', DERIBIT_OTC_TAPE_CHANNEL] },
    },
    pingMessage: { jsonrpc: '2.0', id: 0, method: 'public/test', params: {} },
    pingIntervalMs: DERIBIT_BLOCK_KEEPALIVE_MS,
    parseFrame: (msg, emit) => {
      otcAssembler ??= new DeribitOtcBlockAssembler(emit);
      return parseDeribitBlockFrame(msg, otcAssembler);
    },
    seed: async () => {
      const [rfqTrades, otcTrades] = await Promise.all([
        seedDeribitBlockTrades(),
        fetchDeribitOtcSeed(fetchJson),
      ]);
      return [...rfqTrades, ...otcTrades];
    },
    onDispose: () => {
      otcAssembler?.dispose();
      otcAssembler = null;
    },
  });
}

// ── Bybit (WS real-time) ─────────────────────────────────────

const BybitBlockTradeSchema = z.object({
  rfqId: z.string(),
  strategyType: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  legs: z
    .array(
      z.object({
        category: z.string().optional(),
        symbol: z.string(),
        side: z.string(),
        price: z.string(),
        qty: z.string(),
        markPrice: z.string().optional(),
      }),
    )
    .min(1),
});

function mapBybitBlockTrade(trade: z.infer<typeof BybitBlockTradeSchema>): BlockTradeEvent | null {
  const optionLegs = trade.legs.filter(
    (leg) => leg.category?.toLowerCase() === 'option' && isOptionInstrument(leg.symbol),
  );
  const firstLeg = optionLegs[0];
  if (!firstLeg || optionLegs.length !== trade.legs.length) return null;

  const underlying = extractUnderlying(firstLeg.symbol);
  const totalSize = optionLegs.reduce((sum, leg) => sum + Number(leg.qty), 0);

  return {
    venue: 'bybit',
    source: 'rfq',
    tradeId: trade.rfqId,
    exchangeEvidence: { rfqId: trade.rfqId, expectedLegCount: trade.legs.length, groupComplete: true },
    timestamp: Number(trade.updatedAt ?? trade.createdAt),
    underlying,
    direction: firstLeg.side.toLowerCase() as 'buy' | 'sell',
    strategy: trade.strategyType?.trim()
      ? trade.strategyType.toUpperCase()
      : optionLegs.length > 1
        ? 'CUSTOM'
        : null,
    legs: optionLegs.map((leg) => ({
      instrument: leg.symbol,
      direction: leg.side.toLowerCase() as 'buy' | 'sell',
      price: Number(leg.price),
      size: Number(leg.qty),
      ratio: 1,
    })),
    totalSize,
    // markPrice per leg is the option's mark price at execution time (USDT ≈ USD).
    // Fall back to execution price if markPrice is absent.
    notionalUsd: optionLegs.reduce(
      (sum, leg) => sum + Number(leg.markPrice ?? leg.price) * Number(leg.qty),
      0,
    ),
    indexPrice: null,
  };
}

function parseBybitBlockFrame(msg: Record<string, unknown>): BlockTradeEvent[] {
  const data = msg['data'];
  if (!data || !Array.isArray(data)) return [];

  const trades: BlockTradeEvent[] = [];
  for (const item of data) {
    const parsed = BybitBlockTradeSchema.safeParse(item);
    if (!parsed.success) continue;
    const trade = mapBybitBlockTrade(parsed.data);
    if (trade) trades.push(trade);
  }
  return trades;
}

function bybitBlockStream(): BlockVenueStream {
  return topicBlockStream({
    venue: 'bybit',
    url: BYBIT_RFQ_WS_URL,
    subscribeMessage: { op: 'subscribe', args: ['rfq.open.public.trades'] },
    pingMessage: { op: 'ping' },
    pingIntervalMs: BYBIT_BLOCK_KEEPALIVE_MS,
    parseFrame: parseBybitBlockFrame,
  });
}

// ── OKX (REST poll every 90s) ─────────────────────────────────

const OkxBlockTradeSchema = z.object({
  blockTdId: z.string(),
  cTime: z.string(),
  strategy: z.string().optional(),
  legs: z.array(
    z.object({
      instId: z.string(),
      side: z.string(),
      sz: z.string(),
      px: z.string(),
    }),
  ),
});

function okxBlockPoller(): BlockVenuePoller {
  return {
    venue: 'okx',
    intervalMs: 90_000,
    limit: 100,
    async poll() {
      try {
        const res = await fetch(`${OKX_REST_BASE_URL}${OKX_RFQ_PUBLIC_TRADES}?limit=100`, {
          signal: AbortSignal.timeout(10_000),
        });
        const json = (await res.json()) as Record<string, unknown>;
        const items = json['data'];
        if (!Array.isArray(items)) return [];

        const trades: BlockTradeEvent[] = [];
        for (const item of items) {
          const parsed = OkxBlockTradeSchema.safeParse(item);
          if (!parsed.success) continue;
          const d = parsed.data;

          // Skip non-option trades (spot, futures, swaps)
          const hasOptionLeg = d.legs.some((l) => /-[CP]$/.test(l.instId));
          if (!hasOptionLeg) continue;

          const underlying = extractUnderlying(d.legs[0]?.instId ?? 'BTC');
          const totalSize = d.legs.reduce((sum, l) => sum + Number(l.sz), 0);

          trades.push({
            venue: 'okx',
            source: 'rfq',
            tradeId: d.blockTdId,
            exchangeEvidence: { blockTradeId: d.blockTdId, expectedLegCount: d.legs.length, groupComplete: true },
            timestamp: Number(d.cTime),
            underlying,
            direction: (d.legs[0]?.side.toLowerCase() as 'buy' | 'sell') ?? 'buy',
            strategy:
              d.strategy && d.strategy !== '' ? d.strategy : d.legs.length > 1 ? 'CUSTOM' : null,
            legs: d.legs.map((l) => ({
              instrument: l.instId,
              direction: l.side.toLowerCase() as 'buy' | 'sell',
              price: Number(l.px),
              size: Number(l.sz),
              ratio: 1,
            })),
            totalSize,
            notionalUsd: 0,
            indexPrice: null,
          });
        }
        if (trades.length > 0)
          log.info({ venue: 'okx', count: trades.length }, 'polled block trades');
        return trades;
      } catch (err) {
        log.warn({ venue: 'okx', err: String(err) }, 'block trade poll failed');
        return [];
      }
    },
  };
}

// ── Binance (REST poll every 120s) ────────────────────────────

const BinanceBlockTradeSchema = z.object({
  id: z.number(),
  symbol: z.string(),
  price: z.string(),
  qty: z.string(),
  side: z.number(),
  time: z.number(),
});

function binanceBlockPoller(): BlockVenuePoller {
  return {
    venue: 'binance',
    intervalMs: 120_000,
    limit: 100,
    async poll() {
      try {
        const res = await fetch(`${BINANCE_REST_BASE_URL}${BINANCE_BLOCK_TRADES}?limit=100`, {
          signal: AbortSignal.timeout(10_000),
        });
        const items = (await res.json()) as unknown[];
        if (!Array.isArray(items)) return [];

        const trades: BlockTradeEvent[] = [];
        for (const item of items) {
          const parsed = BinanceBlockTradeSchema.safeParse(item);
          if (!parsed.success) continue;
          const d = parsed.data;
          const underlying = extractUnderlying(d.symbol);
          const price = Number(d.price);
          const size = Math.abs(Number(d.qty));

          trades.push({
            venue: 'binance',
            source: 'rfq',
            tradeId: String(d.id),
            timestamp: d.time,
            underlying,
            direction: d.side === 1 ? 'buy' : 'sell',
            strategy: null,
            legs: [
              {
                instrument: d.symbol,
                direction: d.side === 1 ? 'buy' : 'sell',
                price,
                size,
                ratio: 1,
              },
            ],
            totalSize: size,
            notionalUsd: price * size,
            indexPrice: null,
          });
        }
        if (trades.length > 0)
          log.info({ venue: 'binance', count: trades.length }, 'polled block trades');
        return trades;
      } catch (err) {
        log.warn({ venue: 'binance', err: String(err) }, 'block trade poll failed');
        return [];
      }
    },
  };
}

// ── Derive (REST poll every 90s, filter rfq_id != null) ───────

const DeriveTradeSchema = z.object({
  trade_id: z.string(),
  instrument_name: z.string(),
  direction: z.enum(['buy', 'sell']),
  trade_price: z.string(),
  trade_amount: z.string(),
  index_price: z.string().optional(),
  rfq_id: z.string().nullable().optional(),
  timestamp: z.number(),
});

const DeriveTradeHistoryResponseSchema = z.object({
  result: z
    .object({
      trades: z.array(DeriveTradeSchema),
      pagination: z
        .object({
          count: z.number(),
          num_pages: z.number(),
        })
        .optional(),
    })
    .optional(),
});

function mapDeriveBlockTrade(trade: z.infer<typeof DeriveTradeSchema>): BlockTradeEvent {
  const price = Number(trade.trade_price);
  const size = Number(trade.trade_amount);
  const indexPrice = trade.index_price ? Number(trade.index_price) : null;

  return {
    venue: 'derive',
    source: 'rfq',
    tradeId: trade.trade_id,
    exchangeEvidence: trade.rfq_id ? { rfqId: trade.rfq_id } : {},
    timestamp: trade.timestamp,
    underlying: extractUnderlying(trade.instrument_name),
    direction: trade.direction,
    strategy: null,
    legs: [
      {
        instrument: trade.instrument_name,
        direction: trade.direction,
        price,
        size,
        ratio: 1,
      },
    ],
    totalSize: size,
    notionalUsd: price * size,
    indexPrice,
  };
}

async function fetchDeriveTradeHistory(
  fromTimestamp: number,
  toTimestamp: number,
): Promise<BlockTradeEvent[]> {
  const trades: BlockTradeEvent[] = [];
  const seen = new Set<string>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_DERIVE_PAGES_PER_POLL) {
    const params = new URLSearchParams({
      instrument_type: 'option',
      page: String(page),
      page_size: String(DERIVE_PAGE_SIZE),
      from_timestamp: String(fromTimestamp),
      to_timestamp: String(toTimestamp),
    });

    const json = await fetchJson(`${DERIVE_REST_BASE_URL}${DERIVE_GET_TRADE_HISTORY}?${params}`);
    const parsed = DeriveTradeHistoryResponseSchema.safeParse(json);
    if (!parsed.success) break;

    const result = parsed.data.result;
    const pageTrades = result?.trades ?? [];
    totalPages = result?.pagination?.num_pages ?? page;
    if (pageTrades.length === 0) break;

    for (const item of pageTrades) {
      if (!item.rfq_id) continue;
      if (seen.has(item.trade_id)) continue;
      seen.add(item.trade_id);
      trades.push(mapDeriveBlockTrade(item));
    }

    page += 1;
  }

  return trades;
}

function deriveBlockPoller(): BlockVenuePoller {
  let nextFromTimestamp: number | null = null;

  return {
    venue: 'derive',
    intervalMs: 90_000,
    async poll() {
      try {
        const now = Date.now();
        const fromTimestamp = nextFromTimestamp ?? now - DERIVE_INITIAL_LOOKBACK_MS;
        const trades = await fetchDeriveTradeHistory(fromTimestamp, now);
        const newestTimestamp = trades.reduce<number | null>((latest, trade) => {
          if (latest == null || trade.timestamp > latest) return trade.timestamp;
          return latest;
        }, null);

        if (newestTimestamp != null) {
          nextFromTimestamp = Math.max(newestTimestamp - DERIVE_POLL_OVERLAP_MS, 0);
        } else {
          nextFromTimestamp = Math.max(now - DERIVE_POLL_OVERLAP_MS, fromTimestamp);
        }

        if (trades.length > 0) {
          log.info(
            { venue: 'derive', count: trades.length, fromTimestamp, toTimestamp: now },
            'polled block trades',
          );
        }
        return trades;
      } catch (err) {
        log.warn({ venue: 'derive', err: String(err) }, 'block trade poll failed');
        return [];
      }
    },
  };
}
