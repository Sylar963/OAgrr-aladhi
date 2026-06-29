import type WebSocket from 'ws';
import type { VenueId } from '../../types/common.js';

export interface TradeEvent {
  venue: VenueId;
  tradeId: string | null;
  instrument: string;
  underlying: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  iv: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  isBlock: boolean;
  timestamp: number;
}

export interface TradeRuntimeHealth {
  venue: VenueId;
  underlying: string;
  connected: boolean;
  lastMessageAt: number | null;
  lastTradeAt: number | null;
  lastStatusAt: number | null;
  reconnects: number;
  errors: number;
  seedTrades: number;
  bufferedTrades: number;
}

export interface TradeStreamState {
  connected: boolean;
  lastMessageAt: number | null;
  lastTradeAt: number | null;
  lastStatusAt: number | null;
  reconnects: number;
  errors: number;
  seedTrades: number;
}

export interface VenueStream {
  venue: VenueId;
  // Live-socket venues set url/connect/parse. REST-seed-only venues (e.g.
  // Paradex, whose WS trades.{symbol} ACKs but never delivers and would trip the
  // staleness watchdog into a reconnect loop) omit all three and carry the tape
  // entirely through seed + reseedIntervalMs — the runtime opens no socket.
  // Some venues (Coincall) require a freshly-signed URL per connect — a bare
  // string is stale after the first timestamped signature. Allow a thunk.
  url?: string | (() => string);
  connectionKey?: (underlyings: string[]) => string;
  connect?: (ws: WebSocket, underlyings: string[]) => void;
  subscribe?: (ws: WebSocket, underlyings: string[]) => void;
  parse?: (msg: unknown, underlyings: string[]) => TradeEvent[];
  seed?: (underlying: string) => Promise<TradeEvent[]>;
  // Set on venues whose WS stream alone produces sparse history (e.g. Coincall
  // has per-symbol prints with no bulk history endpoint). The runtime invokes
  // `seed()` on this interval after startup; tradeId-based dedup in
  // pushTradeEvents prevents duplicates across reseeds.
  reseedIntervalMs?: number;
  startKeepalive?: (ws: WebSocket) => ReturnType<typeof setInterval>;
}
