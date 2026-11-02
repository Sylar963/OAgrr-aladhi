import type { AggregatedSpotUnderlying } from '@oggregator/protocol';
import { z } from 'zod';
import type { SpotCandleResolutionSec } from '../../services/spot-candles.js';
import type { VenueBar } from './aggregate.js';

export type SpotVenue =
  | 'deribit'
  | 'binance'
  | 'bybit'
  | 'okx'
  | 'gateio'
  | 'coinbase'
  | 'hyperliquid';

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
  /** Binance leads: its bar counts twice in each bucket's median. */
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
  parse: (raw: string) => SpotStreamEvent[];
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
    const json = await getJson(fetchImpl, `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=1000`);
    return BinanceRestSchema.parse(json).map(([timestamp, open, high, low, close, volume]) => ({ timestamp, open, high, low, close, volume }));
  },
  url: 'wss://stream.binance.com:9443/ws',
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
    const json = await getJson(fetchImpl, `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&start=${startMs}&end=${endMs}&limit=1000`);
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
  url: 'wss://stream.bybit.com/v5/public/spot',
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

// OKX. Plain 1D opens on Hong Kong time, so it needs the UTC bar; 4H already sits on the UTC grid.
const OKX_INTERVALS: SpotVenueDef['resolutions'] = { 60: '1m', 300: '5m', 900: '15m', 1800: '30m', 3600: '1H', 14400: '4H', 86400: '1Dutc' };
const OKX_RAW_ROW = z.array(z.coerce.number()).min(6);
const OkxRestSchema = z.object({ code: z.string(), msg: z.string().optional(), data: z.array(OKX_RAW_ROW) });
const OkxFrameSchema = z.object({
  arg: z.object({ channel: z.string(), instId: z.string() }),
  data: z.array(OKX_RAW_ROW),
});

function okxBar(row: number[]): VenueBar {
  return { timestamp: row[0]!, open: row[1]!, high: row[2]!, low: row[3]!, close: row[4]!, volume: row[5]! };
}

const okxTopicArg = (topic: string) => {
  const [channel, instId] = topic.split('|');
  return { channel, instId };
};

const okx: SpotVenueDef = {
  weight: 1,
  pageBars: 100,
  resolutions: OKX_INTERVALS,
  async fetchPage(fetchImpl, symbol, interval, startMs, endMs) {
    const json = await getJson(fetchImpl, `https://www.okx.com/api/v5/market/history-candles?instId=${symbol}&bar=${interval}&after=${endMs + 1}&before=${startMs - 1}&limit=100`);
    const parsed = OkxRestSchema.parse(json);
    if (parsed.code !== '0') throw new Error(`code ${parsed.code} ${parsed.msg ?? ''}`);
    return parsed.data.map(okxBar);
  },
  url: 'wss://ws.okx.com:443/ws/v5/business',
  tickStream: false,
  topic: (symbol, interval) => `candle${interval}|${symbol}`,
  ping: { intervalMs: 20_000, message: 'ping' },
  subscribeMessages: (topics) => [{ op: 'subscribe', args: topics.map(okxTopicArg) }],
  unsubscribeMessages: (topics) => [{ op: 'unsubscribe', args: topics.map(okxTopicArg) }],
  parse(raw) {
    const frame = OkxFrameSchema.safeParse(parseJson(raw));
    if (!frame.success) return [];
    const resolutionSec = resolutionOf(OKX_INTERVALS, frame.data.arg.channel.replace('candle', ''));
    if (resolutionSec == null) return [];
    return frame.data.data.map((row) => ({ kind: 'bar', symbol: frame.data.arg.instId, resolutionSec, bar: okxBar(row) }));
  },
};

// Gate.io. REST rows are [t, quote volume, close, high, low, open, base volume, closed].
const GateRestSchema = z.array(z.array(z.coerce.string()).min(7));
const GateFrameSchema = z.object({
  channel: z.literal('spot.candlesticks'),
  event: z.literal('update'),
  result: z.object({
    t: z.coerce.number(),
    o: z.coerce.number(),
    h: z.coerce.number(),
    l: z.coerce.number(),
    c: z.coerce.number(),
    a: z.coerce.number(),
    n: z.string(),
  }),
});

const gateMessage = (event: 'subscribe' | 'unsubscribe', topic: string) => {
  const separator = topic.indexOf('|');
  return {
    time: Math.floor(Date.now() / 1000),
    channel: 'spot.candlesticks',
    event,
    payload: [topic.slice(0, separator), topic.slice(separator + 1)],
  };
};

const gateio: SpotVenueDef = {
  weight: 1,
  // Its 1000-point cap counts both ends of the range.
  pageBars: 999,
  resolutions: STANDARD_INTERVALS,
  async fetchPage(fetchImpl, symbol, interval, startMs, endMs) {
    const from = Math.floor(startMs / 1000);
    const to = Math.floor(endMs / 1000);
    const json = await getJson(fetchImpl, `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${symbol}&interval=${interval}&from=${from}&to=${to}`);
    return GateRestSchema.parse(json).map((row) => ({
      timestamp: Number(row[0]) * 1000,
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
      open: Number(row[5]),
      volume: Number(row[6]),
    }));
  },
  url: 'wss://api.gateio.ws/ws/v4/',
  tickStream: false,
  topic: (symbol, interval) => `${interval}|${symbol}`,
  ping: { intervalMs: 20_000, message: () => ({ time: Math.floor(Date.now() / 1000), channel: 'spot.ping' }) },
  subscribeMessages: (topics) => topics.map((topic) => gateMessage('subscribe', topic)),
  unsubscribeMessages: (topics) => topics.map((topic) => gateMessage('unsubscribe', topic)),
  parse(raw) {
    const frame = GateFrameSchema.safeParse(parseJson(raw));
    if (!frame.success) return [];
    const { t, o, h, l, c, a, n } = frame.data.result;
    const separator = n.indexOf('_');
    const resolutionSec = resolutionOf(STANDARD_INTERVALS, n.slice(0, separator));
    if (resolutionSec == null) return [];
    return [{ kind: 'bar', symbol: n.slice(separator + 1), resolutionSec, bar: { timestamp: t * 1000, open: o, high: h, low: l, close: c, volume: a } }];
  },
};

// Coinbase. No candle stream and no 30m/4h bars, so live bars are built from
// matches and those two resolutions roll up from 15m and 1h.
const COINBASE_INTERVALS: SpotVenueDef['resolutions'] = { 60: '60', 300: '300', 900: '900', 3600: '3600', 86400: '86400' };
const CoinbaseRestSchema = z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]));
const CoinbaseFrameSchema = z.object({
  type: z.literal('match'),
  product_id: z.string(),
  price: z.coerce.number(),
  size: z.coerce.number(),
  time: z.string(),
});

const coinbase: SpotVenueDef = {
  weight: 1,
  pageBars: 300,
  resolutions: COINBASE_INTERVALS,
  async fetchPage(fetchImpl, symbol, interval, startMs, endMs) {
    const start = new Date(startMs).toISOString();
    const end = new Date(endMs).toISOString();
    const json = await getJson(fetchImpl, `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${interval}&start=${start}&end=${end}`);
    return CoinbaseRestSchema.parse(json).map(([time, low, high, open, close, volume]) => ({ timestamp: time * 1000, open, high, low, close, volume }));
  },
  url: 'wss://ws-feed.exchange.coinbase.com',
  tickStream: true,
  topic: (symbol) => symbol,
  // Thin products can go quiet, and the heartbeat tells that apart from a dead socket.
  subscribeMessages: (topics) => [{ type: 'subscribe', product_ids: topics, channels: ['matches', 'heartbeat'] }],
  unsubscribeMessages: (topics) => [{ type: 'unsubscribe', product_ids: topics, channels: ['matches', 'heartbeat'] }],
  parse(raw) {
    const frame = CoinbaseFrameSchema.safeParse(parseJson(raw));
    if (!frame.success) return [];
    const { product_id, price, size, time } = frame.data;
    return [{ kind: 'tick', symbol: product_id, timestamp: Date.parse(time), price, size }];
  },
};

// Hyperliquid
const HyperliquidBarSchema = z.object({
  t: z.number(),
  s: z.string(),
  i: z.string(),
  o: z.coerce.number(),
  h: z.coerce.number(),
  l: z.coerce.number(),
  c: z.coerce.number(),
  v: z.coerce.number(),
});
const HyperliquidFrameSchema = z.object({ channel: z.literal('candle'), data: HyperliquidBarSchema });

const hyperliquidMessage = (method: 'subscribe' | 'unsubscribe', topic: string) => {
  const [coin, interval] = topic.split('|');
  return { method, subscription: { type: 'candle', coin, interval } };
};

const hyperliquid: SpotVenueDef = {
  weight: 1,
  pageBars: 5000,
  resolutions: STANDARD_INTERVALS,
  async fetchPage(fetchImpl, symbol, interval, startMs, endMs) {
    const json = await getJson(fetchImpl, 'https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'candleSnapshot', req: { coin: symbol, interval, startTime: startMs, endTime: endMs } }),
    });
    return z.array(HyperliquidBarSchema).parse(json).map((k) => ({ timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }));
  },
  url: 'wss://api.hyperliquid.xyz/ws',
  tickStream: false,
  topic: (symbol, interval) => `${symbol}|${interval}`,
  ping: { intervalMs: 30_000, message: { method: 'ping' } },
  subscribeMessages: (topics) => topics.map((topic) => hyperliquidMessage('subscribe', topic)),
  unsubscribeMessages: (topics) => topics.map((topic) => hyperliquidMessage('unsubscribe', topic)),
  parse(raw) {
    const frame = HyperliquidFrameSchema.safeParse(parseJson(raw));
    if (!frame.success) return [];
    const k = frame.data.data;
    const resolutionSec = resolutionOf(STANDARD_INTERVALS, k.i);
    if (resolutionSec == null) return [];
    return [{ kind: 'bar', symbol: k.s, resolutionSec, bar: { timestamp: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v } }];
  },
};

// Deribit. History is its trade klines, which go flat between prints. It has no 4h,
// and its 1D opens at 08:00 UTC, off every other venue's day, so both roll up from 1h.
// chart.trades and trades.* acknowledge nothing for spot pairs, so live bars come from
// the book mid on the ticker channel.
const DERIBIT_INTERVALS: SpotVenueDef['resolutions'] = { 60: '1', 300: '5', 900: '15', 1800: '30', 3600: '60' };
const DeribitRestSchema = z.object({
  result: z.object({
    ticks: z.array(z.number()),
    open: z.array(z.number()),
    high: z.array(z.number()),
    low: z.array(z.number()),
    close: z.array(z.number()),
    volume: z.array(z.number()),
  }),
});
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
    const json = await getJson(fetchImpl, `https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=${symbol}&resolution=${interval}&start_timestamp=${startMs}&end_timestamp=${endMs}`);
    const { ticks, open, high, low, close, volume } = DeribitRestSchema.parse(json).result;
    return ticks.map((timestamp, i) => ({
      timestamp,
      open: open[i]!,
      high: high[i]!,
      low: low[i]!,
      close: close[i]!,
      volume: volume[i]!,
    }));
  },
  url: 'wss://www.deribit.com/ws/api/v2',
  tickStream: true,
  topic: (symbol) => `ticker.${symbol}.agg2`,
  parse: () => [],
};

export const SPOT_VENUES: Record<SpotVenue, SpotVenueDef> = {
  deribit,
  binance,
  bybit,
  okx,
  gateio,
  coinbase,
  hyperliquid,
};

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
// Binance's LITUSDT is another token (0.74 against 3.07 on Bybit, OKX and Gate).
const BINANCE_UNLISTED = new Set<SpotAsset>(['KAS', 'LIT']);
const BYBIT_UNLISTED = new Set<SpotAsset>(['ZEC']);
const OKX_UNLISTED = new Set<SpotAsset>(['KAS']);
const COINBASE_UNLISTED = new Set<SpotAsset>(['KAS', 'LIT', 'ORDI', 'TRX', 'XAUT']);
// Spot pair ids from spotMeta. Hyperliquid's TRUMP pair is another token (0.0009 against 1.61).
const HYPERLIQUID_PAIRS: Partial<Record<SpotAsset, string>> = {
  BTC: '@142', ETH: '@151', HYPE: '@107', AVAX: '@306', ENA: '@206', SOL: '@156', ZEC: '@272',
};

export const USDT_RATE_LEG: SpotLeg = { venue: 'coinbase', symbol: 'USDT-USD', quote: 'USD' };

export function spotLegs(underlying: AggregatedSpotUnderlying): SpotLeg[] {
  const asset = ASSET_OF[underlying];
  const legs: SpotLeg[] = [];
  // USDC counts as USD: Deribit's BTC_USDC book matched Coinbase BTC-USD to the cent when checked.
  if (DERIBIT_ASSETS.has(asset)) legs.push({ venue: 'deribit', symbol: `${asset}_USDC`, quote: 'USD' });
  if (!BINANCE_UNLISTED.has(asset)) legs.push({ venue: 'binance', symbol: `${asset}USDT`, quote: 'USDT' });
  if (!BYBIT_UNLISTED.has(asset)) legs.push({ venue: 'bybit', symbol: `${asset}USDT`, quote: 'USDT' });
  if (!OKX_UNLISTED.has(asset)) legs.push({ venue: 'okx', symbol: `${asset}-USDT`, quote: 'USDT' });
  legs.push({ venue: 'gateio', symbol: `${asset}_USDT`, quote: 'USDT' });
  if (!COINBASE_UNLISTED.has(asset)) legs.push({ venue: 'coinbase', symbol: `${asset}-USD`, quote: 'USD' });
  const pair = HYPERLIQUID_PAIRS[asset];
  if (pair) legs.push({ venue: 'hyperliquid', symbol: pair, quote: 'USD' });
  return legs;
}
