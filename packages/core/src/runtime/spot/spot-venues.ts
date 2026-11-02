import type { AggregatedSpotUnderlying } from '@oggregator/protocol';
import { z } from 'zod';
import {
  BINANCE_SPOT_REST_BASE_URL,
  BINANCE_SPOT_WS_URL,
  BYBIT_KLINE,
  BYBIT_REST_BASE_URL,
  BYBIT_SPOT_WS_URL,
  DERIBIT_WS_URL,
} from '../../feeds/shared/endpoints.js';
import { fetchDeribitCandles, type SpotCandleResolutionSec } from '../../services/spot-candles.js';
import type { VenueBar } from './spot-aggregate.js';

export type SpotVenue = 'binance' | 'bybit' | 'deribit';

export interface SpotLeg {
  venue: SpotVenue;
  symbol: string;
  quote: 'USD' | 'USDT';
}

export type SpotStreamEvent =
  | { kind: 'bar'; symbol: string; resolutionSec: SpotCandleResolutionSec; bar: VenueBar }
  | { kind: 'tick'; symbol: string; timestamp: number; price: number; size: number };

export type SpotFetch = typeof fetch;

export interface SpotVenueDef {
  /** Binance leads with two votes in each bucket's median, against one each for the others. */
  weight: number;
  pageBars: number;
  resolutions: Partial<Record<SpotCandleResolutionSec, string>>;
  fetchPage: (
    fetchImpl: SpotFetch,
    symbol: string,
    interval: string,
    startMs: number,
    endMs: number,
  ) => Promise<VenueBar[]>;
  url: string;
  /** Trades or quotes rather than klines: the runtime builds each active resolution's bar. */
  tickStream: boolean;
  topic: (symbol: string, interval: string) => string;
  ping?: { intervalMs: number; message: string | Record<string, unknown> | (() => Record<string, unknown>) };
  subscribeMessages?: (topics: readonly string[]) => (string | Record<string, unknown>)[];
  unsubscribeMessages?: (topics: readonly string[]) => (string | Record<string, unknown>)[];
  /** Deribit frames arrive already split by JsonRpcWsClient; see parseDeribitTicker. */
  parse?: (raw: string) => SpotStreamEvent[];
}

const REQUEST_TIMEOUT_MS = 5_000;

async function getJson(fetchImpl: SpotFetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    headers: { accept: 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolutionOf(
  resolutions: SpotVenueDef['resolutions'],
  interval: string,
): SpotCandleResolutionSec | null {
  for (const [sec, value] of Object.entries(resolutions)) {
    if (value === interval) return Number(sec) as SpotCandleResolutionSec;
  }
  return null;
}

const STANDARD_INTERVALS: SpotVenueDef['resolutions'] = {
  60: '1m',
  300: '5m',
  900: '15m',
  1800: '30m',
  3600: '1h',
  14400: '4h',
  86400: '1d',
};

// Binance
const BinanceRestSchema = z.array(z.tuple([z.number(), z.coerce.number(), z.coerce.number(), z.coerce.number(), z.coerce.number(), z.coerce.number()]).rest(z.unknown()));
const BinanceFrameSchema = z.object({
  e: z.literal('kline'),
  s: z.string(),
  k: z.object({
    t: z.number(),
    i: z.string(),
    o: z.coerce.number(),
    h: z.coerce.number(),
    l: z.coerce.number(),
    c: z.coerce.number(),
    v: z.coerce.number(),
  }),
});

const binance: SpotVenueDef = {
  weight: 2,
  pageBars: 1000,
  resolutions: STANDARD_INTERVALS,
  async fetchPage(fetchImpl, symbol, interval, startMs, endMs) {
    const json = await getJson(fetchImpl, `${BINANCE_SPOT_REST_BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=1000`);
    return BinanceRestSchema.parse(json).map(([timestamp, open, high, low, close, volume]) => ({ timestamp, open, high, low, close, volume }));
  },
  url: BINANCE_SPOT_WS_URL,
  tickStream: false,
  topic: (symbol, interval) => `${symbol.toLowerCase()}@kline_${interval}`,
  subscribeMessages: (topics) => [{ method: 'SUBSCRIBE', params: topics, id: 1 }],
  unsubscribeMessages: (topics) => [{ method: 'UNSUBSCRIBE', params: topics, id: 2 }],
  parse(raw) {
    const frame = BinanceFrameSchema.safeParse(parseJson(raw));
    if (!frame.success) return [];
    const { s, k } = frame.data;
    const resolutionSec = resolutionOf(STANDARD_INTERVALS, k.i);
    if (resolutionSec == null) return [];
    return [{ kind: 'bar', symbol: s, resolutionSec, bar: { timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v } }];
  },
};

// Bybit
const BYBIT_INTERVALS: SpotVenueDef['resolutions'] = { 60: '1', 300: '5', 900: '15', 1800: '30', 3600: '60', 14400: '240', 86400: 'D' };
const BYBIT_MAX_ARGS = 10;
const BybitRestSchema = z.object({
  retCode: z.number(),
  retMsg: z.string().optional(),
  result: z.object({ list: z.array(z.array(z.coerce.number()).min(6)).optional() }),
});
const BybitFrameSchema = z.object({
  topic: z.string(),
  data: z.array(
    z.object({
      start: z.number(),
      interval: z.string(),
      open: z.coerce.number(),
      high: z.coerce.number(),
      low: z.coerce.number(),
      close: z.coerce.number(),
      volume: z.coerce.number(),
    }),
  ),
});

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const bybit: SpotVenueDef = {
  weight: 1,
  pageBars: 1000,
  resolutions: BYBIT_INTERVALS,
  async fetchPage(fetchImpl, symbol, interval, startMs, endMs) {
    const json = await getJson(fetchImpl, `${BYBIT_REST_BASE_URL}${BYBIT_KLINE}?category=spot&symbol=${symbol}&interval=${interval}&start=${startMs}&end=${endMs}&limit=1000`);
    const parsed = BybitRestSchema.parse(json);
    if (parsed.retCode !== 0) throw new Error(`retCode ${parsed.retCode} ${parsed.retMsg ?? ''}`);
    return (parsed.result.list ?? []).map((row) => ({
      timestamp: row[0]!,
      open: row[1]!,
      high: row[2]!,
      low: row[3]!,
      close: row[4]!,
      volume: row[5]!,
    }));
  },
  url: BYBIT_SPOT_WS_URL,
  tickStream: false,
  topic: (symbol, interval) => `kline.${interval}.${symbol}`,
  ping: { intervalMs: 20_000, message: { op: 'ping' } },
  subscribeMessages: (topics) => chunk(topics, BYBIT_MAX_ARGS).map((args) => ({ op: 'subscribe', args })),
  unsubscribeMessages: (topics) => chunk(topics, BYBIT_MAX_ARGS).map((args) => ({ op: 'unsubscribe', args })),
  parse(raw) {
    const frame = BybitFrameSchema.safeParse(parseJson(raw));
    if (!frame.success) return [];
    const symbol = frame.data.topic.split('.')[2];
    if (!symbol) return [];
    return frame.data.data.flatMap((row): SpotStreamEvent[] => {
      const resolutionSec = resolutionOf(BYBIT_INTERVALS, row.interval);
      if (resolutionSec == null) return [];
      return [{ kind: 'bar', symbol, resolutionSec, bar: { timestamp: row.start, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume } }];
    });
  },
};

// Deribit. History is its trade klines, which go flat between prints. It has no 4h,
// and its 1D opens at 08:00 UTC, off every other venue's day, so both roll up from 1h.
// chart.trades and trades.* acknowledge nothing for spot pairs, so live bars come from
// the book mid on the ticker channel.
const DERIBIT_INTERVALS: SpotVenueDef['resolutions'] = { 60: '1', 300: '5', 900: '15', 1800: '30', 3600: '60' };
const DeribitTickerSchema = z.object({
  timestamp: z.number(),
  instrument_name: z.string(),
  best_bid_price: z.number().nullable(),
  best_ask_price: z.number().nullable(),
});

export function parseDeribitTicker(data: unknown): SpotStreamEvent[] {
  const ticker = DeribitTickerSchema.safeParse(data);
  if (!ticker.success) return [];
  const { timestamp, instrument_name, best_bid_price, best_ask_price } = ticker.data;
  if (!best_bid_price || !best_ask_price) return [];
  return [{ kind: 'tick', symbol: instrument_name, timestamp, price: (best_bid_price + best_ask_price) / 2, size: 0 }];
}

const deribit: SpotVenueDef = {
  weight: 1,
  pageBars: 4800,
  resolutions: DERIBIT_INTERVALS,
  async fetchPage(fetchImpl, symbol, interval, startMs, endMs) {
    const candles = await fetchDeribitCandles(symbol, interval, startMs, endMs, fetchImpl);
    return candles.map((candle) => ({ ...candle, volume: candle.volume ?? 0 }));
  },
  url: DERIBIT_WS_URL,
  tickStream: true,
  topic: (symbol) => `ticker.${symbol}.agg2`,
};

export const SPOT_VENUES: Record<SpotVenue, SpotVenueDef> = { binance, bybit, deribit };

/** Coarsest bars the venue can serve that add up to `resolutionSec`. */
export function sourceResolution(venue: SpotVenue, resolutionSec: SpotCandleResolutionSec): SpotCandleResolutionSec {
  const { resolutions } = SPOT_VENUES[venue];
  if (resolutions[resolutionSec] != null) return resolutionSec;
  const candidates: SpotCandleResolutionSec[] = [3600, 900, 300, 60];
  const source = candidates.find((sec) => resolutions[sec] != null && resolutionSec % sec === 0 && sec < resolutionSec);
  if (source == null) throw new Error(`${venue} cannot build ${resolutionSec}s bars`);
  return source;
}

type SpotAsset = 'BTC' | 'ETH' | Exclude<AggregatedSpotUnderlying, 'BTC_USDC' | 'ETH_USDC'>;

const ASSET_OF: Record<AggregatedSpotUnderlying, SpotAsset> = {
  BTC: 'BTC', BTC_USDC: 'BTC', ETH: 'ETH', ETH_USDC: 'ETH', HYPE: 'HYPE', AAVE: 'AAVE', ADA: 'ADA',
  AVAX: 'AVAX', BNB: 'BNB', DOGE: 'DOGE', ENA: 'ENA', KAS: 'KAS', LIT: 'LIT', LTC: 'LTC', NEAR: 'NEAR',
  ORDI: 'ORDI', SOL: 'SOL', SUI: 'SUI', TRUMP: 'TRUMP', TRX: 'TRX', WLFI: 'WLFI', XRP: 'XRP',
  ZEC: 'ZEC', XAUT: 'XAUT',
};

const DERIBIT_ASSETS = new Set<SpotAsset>(['AAVE', 'ADA', 'AVAX', 'BNB', 'BTC', 'DOGE', 'ETH', 'HYPE', 'LTC', 'NEAR', 'SOL', 'SUI', 'XRP']);
// Binance's LITUSDT is another token (0.74 against 3.07 on Bybit).
const BINANCE_UNLISTED = new Set<SpotAsset>(['KAS', 'LIT']);
const BYBIT_UNLISTED = new Set<SpotAsset>(['ZEC']);

/** USDC priced in USDT on the lead venue; its inverse converts USDT pairs to USD. */
export const USDT_RATE_LEG: SpotLeg = { venue: 'binance', symbol: 'USDCUSDT', quote: 'USD' };

export function spotLegs(underlying: AggregatedSpotUnderlying): SpotLeg[] {
  const asset = ASSET_OF[underlying];
  const legs: SpotLeg[] = [];
  if (!BINANCE_UNLISTED.has(asset)) legs.push({ venue: 'binance', symbol: `${asset}USDT`, quote: 'USDT' });
  if (!BYBIT_UNLISTED.has(asset)) legs.push({ venue: 'bybit', symbol: `${asset}USDT`, quote: 'USDT' });
  // USDC counts as USD: Deribit's BTC_USDC book matched Coinbase BTC-USD to the cent when checked.
  if (DERIBIT_ASSETS.has(asset)) legs.push({ venue: 'deribit', symbol: `${asset}_USDC`, quote: 'USD' });
  return legs;
}
