import { VOL_HEATMAP_COLUMN_MS, type VolHeatmapColumn, type VolHeatmapMeta } from '@oggregator/protocol';
import { DERIBIT_WS_URL } from '../../feeds/shared/endpoints.js';
import { JsonRpcWsClient } from '../../feeds/shared/jsonrpc-client.js';
import { feedLogger } from '../../utils/logger.js';
import { VolHeatmapEngine } from './engine.js';
import { type HeatmapInstrument, selectHeatmapInstruments } from './select.js';
import {
  DeribitBookSnapshotSchema,
  DeribitDvolPushSchema,
  DeribitHeatmapInstrumentsSchema,
  DeribitHeatmapTickerSchema,
  DeribitHeatmapTradesSchema,
  DeribitIndexPriceSchema,
  DeribitVolatilityIndexDataSchema,
} from './types.js';

const log = feedLogger('vol-heatmap');

const SAMPLE_INTERVAL_MS = 1_000;
const RESELECT_INTERVAL_MS = 10 * 60_000;
const SUBSCRIBE_BATCH_SIZE = 50;
const SUBSCRIBE_BATCH_DELAY_MS = 300;
const FALLBACK_ATM_VOL = 0.5;
const BOOK_DEPTH = 10;

export interface HeatmapRpc {
  connect(): Promise<void>;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  subscribe(channels: string[], source?: string): Promise<void>;
  unsubscribe(channels: string[]): Promise<void>;
  onSubscription(handler: (channel: string, data: unknown) => void): void;
  disconnect(): Promise<void>;
}

export interface VolHeatmapFeedEvents {
  onColumn(currency: string, column: VolHeatmapColumn): void;
  onMeta(currency: string, meta: VolHeatmapMeta): void;
}

export interface VolHeatmapFeedOptions {
  rpc?: HeatmapRpc;
  now?: () => number;
  columnMs?: number;
}

interface CurrencyState {
  engine: VolHeatmapEngine;
  channels: Set<string>;
  forwardSources: Map<string, number>;
}

const bookChannel = (name: string) => `book.${name}.none.${BOOK_DEPTH}.agg2`;
const tickerChannel = (name: string) => `ticker.${name}.agg2`;

/**
 * Streams Deribit option books for the instruments DVOL is built from and emits one heatmap
 * column per currency every `columnMs`. Runs on its own socket so book traffic can never stall
 * the chain feed's Deribit session.
 */
export class VolHeatmapFeed {
  private readonly rpc: HeatmapRpc;
  private readonly now: () => number;
  private readonly columnMs: number;
  private readonly states = new Map<string, CurrencyState>();
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private reselectTimer: ReturnType<typeof setInterval> | null = null;
  private columnStart = 0;
  private stopped = false;

  constructor(
    private readonly currencies: readonly string[],
    private readonly events: VolHeatmapFeedEvents,
    options: VolHeatmapFeedOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.columnMs = options.columnMs ?? VOL_HEATMAP_COLUMN_MS;
    this.rpc =
      options.rpc ??
      new JsonRpcWsClient(DERIBIT_WS_URL, 'vol-heatmap', {
        heartbeatIntervalSec: 30,
        resubscribeBatchSize: SUBSCRIBE_BATCH_SIZE,
        resubscribeBatchDelayMs: SUBSCRIBE_BATCH_DELAY_MS,
        onStatusChange: (state) => {
          if (state !== 'connected') for (const s of this.states.values()) s.engine.clearBooks();
        },
      });
    for (const currency of currencies) {
      this.states.set(currency, {
        engine: new VolHeatmapEngine(),
        channels: new Set(),
        forwardSources: new Map(),
      });
    }
  }

  async start(): Promise<void> {
    this.rpc.onSubscription((channel, data) => this.handle(channel, data));
    await this.rpc.connect();

    await this.rpc.subscribe(
      this.currencies.flatMap((c) => [
        `deribit_volatility_index.${c.toLowerCase()}_usd`,
        `trades.option.${c}.100ms`,
      ]),
      'vol-heatmap-base',
    );
    for (const currency of this.currencies) await this.reselect(currency);

    this.columnStart = this.alignedColumnStart(this.now());
    this.sampleTimer = setInterval(() => this.tick(), SAMPLE_INTERVAL_MS);
    this.reselectTimer = setInterval(() => {
      void (async () => {
        for (const currency of this.currencies) await this.reselect(currency);
      })();
    }, RESELECT_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.sampleTimer != null) clearInterval(this.sampleTimer);
    if (this.reselectTimer != null) clearInterval(this.reselectTimer);
    this.sampleTimer = null;
    this.reselectTimer = null;
    await this.rpc.disconnect();
  }

  /** Exposed for tests; the sample timer calls it every second. */
  tick(): void {
    const now = this.now();
    const start = this.alignedColumnStart(now);
    if (start !== this.columnStart) {
      for (const [currency, state] of this.states) {
        this.events.onColumn(currency, state.engine.flush(this.columnStart));
      }
      this.columnStart = start;
    }
    for (const state of this.states.values()) state.engine.sample(now);
  }

  async reselect(currency: string): Promise<void> {
    const state = this.states.get(currency);
    if (state == null || this.stopped) return;
    try {
      const [rawInstruments, rawIndex] = await Promise.all([
        this.rpc.call('public/get_instruments', { currency, kind: 'option', expired: false }),
        this.rpc.call('public/get_index_price', { index_name: `${currency.toLowerCase()}_usd` }),
      ]);
      const instruments: HeatmapInstrument[] = DeribitHeatmapInstrumentsSchema.parse(
        rawInstruments,
      ).map((i) => ({
        name: i.instrument_name,
        strike: i.strike,
        right: i.option_type,
        expiry: i.expiration_timestamp,
      }));
      const spot = DeribitIndexPriceSchema.parse(rawIndex).index_price;
      const atmVol = state.engine.currentDvol ?? (await this.fetchDvol(currency)) ?? FALLBACK_ATM_VOL;

      const selection = selectHeatmapInstruments(instruments, {
        now: this.now(),
        spot,
        atmVol,
      });
      const forwardSources = new Map<string, number>();
      for (const [expiry, name] of selection.forwardSources) forwardSources.set(name, expiry);

      const next = new Set<string>([
        ...selection.instruments.map((i) => bookChannel(i.name)),
        ...[...forwardSources.keys()].map(tickerChannel),
      ]);
      const removed = [...state.channels].filter((c) => !next.has(c));
      const added = [...next].filter((c) => !state.channels.has(c));

      state.engine.setInstruments(selection.instruments);
      state.forwardSources = forwardSources;
      if (removed.length > 0) await this.rpc.unsubscribe(removed);
      for (let i = 0; i < added.length; i += SUBSCRIBE_BATCH_SIZE) {
        if (i > 0) await delay(SUBSCRIBE_BATCH_DELAY_MS);
        await this.rpc.subscribe(added.slice(i, i + SUBSCRIBE_BATCH_SIZE), `vol-heatmap-${currency}`);
      }
      state.channels = next;

      this.events.onMeta(currency, {
        expiries: selection.expiries.map((e) => new Date(e).toISOString().slice(0, 10)),
        instruments: selection.instruments.length,
        updatedAt: this.now(),
      });
      if (added.length > 0 || removed.length > 0) {
        log.info(
          { currency, instruments: selection.instruments.length, added: added.length, removed: removed.length },
          'vol heatmap instruments selected',
        );
      }
    } catch (err: unknown) {
      log.warn({ currency, err: String(err) }, 'vol heatmap reselect failed');
    }
  }

  private async fetchDvol(currency: string): Promise<number | null> {
    const now = this.now();
    try {
      const raw = await this.rpc.call('public/get_volatility_index_data', {
        currency,
        start_timestamp: now - 60 * 60_000,
        end_timestamp: now,
        resolution: '60',
      });
      const close = DeribitVolatilityIndexDataSchema.parse(raw).data.at(-1)?.[4];
      return close != null ? close / 100 : null;
    } catch {
      return null;
    }
  }

  private handle(channel: string, data: unknown): void {
    if (channel.startsWith('book.')) {
      const parsed = DeribitBookSnapshotSchema.safeParse(data);
      if (!parsed.success) return;
      this.stateFor(parsed.data.instrument_name)?.engine.applyBook(
        parsed.data.instrument_name,
        parsed.data.bids,
        parsed.data.asks,
      );
    } else if (channel.startsWith('ticker.')) {
      const parsed = DeribitHeatmapTickerSchema.safeParse(data);
      if (!parsed.success) return;
      const state = this.stateFor(parsed.data.instrument_name);
      const expiry = state?.forwardSources.get(parsed.data.instrument_name);
      if (state != null && expiry != null) state.engine.applyForward(expiry, parsed.data.underlying_price);
    } else if (channel.startsWith('trades.')) {
      const parsed = DeribitHeatmapTradesSchema.safeParse(data);
      if (!parsed.success) return;
      for (const trade of parsed.data) {
        this.stateFor(trade.instrument_name)?.engine.addTrade({
          t: trade.timestamp,
          instrument: trade.instrument_name,
          side: trade.direction,
          price: trade.price,
          amount: trade.amount,
          iv: trade.iv != null ? trade.iv / 100 : null,
        });
      }
    } else if (channel.startsWith('deribit_volatility_index.')) {
      const parsed = DeribitDvolPushSchema.safeParse(data);
      if (!parsed.success) return;
      const currency = parsed.data.index_name.split('_')[0]!.toUpperCase();
      this.states.get(currency)?.engine.applyDvol(parsed.data.volatility / 100);
    }
  }

  private stateFor(instrument: string): CurrencyState | undefined {
    return this.states.get(instrument.slice(0, instrument.indexOf('-')));
  }

  private alignedColumnStart(now: number): number {
    return Math.floor(now / this.columnMs) * this.columnMs;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
