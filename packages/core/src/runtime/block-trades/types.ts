import type { VenueId } from '../../types/common.js';
import type { ExchangeTradeEvidence } from '@oggregator/protocol';

export interface BlockTradeLeg {
  instrument: string;
  direction: 'buy' | 'sell';
  price: number;
  size: number;
  ratio: number;
}

/**
 * `rfq`: matched on the venue's own RFQ/block product.
 * `otc`: negotiated off-venue (Paradigm or bilateral) and only printed on the venue's public tape.
 */
export type BlockTradeSource = 'rfq' | 'otc';

export interface BlockTradeEvent {
  venue: VenueId;
  source: BlockTradeSource;
  tradeId: string;
  timestamp: number;
  underlying: string;
  direction: 'buy' | 'sell';
  strategy: string | null;
  legs: BlockTradeLeg[];
  totalSize: number;
  notionalUsd: number;
  indexPrice: number | null;
  exchangeEvidence?: ExchangeTradeEvidence | undefined;
}

export interface BlockTradeRuntimeHealth {
  venue: VenueId;
  transport: 'ws' | 'poll';
  connected: boolean;
  lastSuccessAt: number | null;
  lastTradeAt: number | null;
  lastStatusAt: number | null;
  lastPollCount: number | null;
  pollLimit: number | null;
  hitLimitCount: number;
  reconnects: number;
  errors: number;
  bufferedTrades: number;
}

export interface BlockVenueState {
  transport: 'ws' | 'poll';
  connected: boolean;
  lastSuccessAt: number | null;
  lastTradeAt: number | null;
  lastStatusAt: number | null;
  lastPollCount: number | null;
  pollLimit: number | null;
  hitLimitCount: number;
  reconnects: number;
  errors: number;
}

export interface BlockVenueStreamHandlers {
  onTrades: (trades: BlockTradeEvent[]) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: () => void;
  onReconnect: () => void;
}

export interface BlockVenueStream {
  venue: VenueId;
  connect: (handlers: BlockVenueStreamHandlers) => void;
  dispose: () => void;
}

export interface BlockVenuePoller {
  venue: VenueId;
  intervalMs: number;
  limit?: number;
  poll: () => Promise<BlockTradeEvent[]>;
}
