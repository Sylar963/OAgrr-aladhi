import { normalizeTradeUnderlying, type TradeEvent } from '@oggregator/core';
import {
  type FlowTrade,
  type InstrumentTradeWsServerMessage,
  VenueIdSchema,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { flowService } from '../services.js';
import { enrichLiveTrade } from './flow.js';

const WS_OPEN = 1;
const MAX_SENT_UIDS = 10_000;

const InstrumentTradeWsQuerySchema = z.object({
  underlying: z.string().min(1),
  venue: z.string().min(1),
  instrument: z.string().min(1),
});

export async function wsInstrumentTradesRoute(app: FastifyInstance) {
  app.get('/ws/instrument-trades', { websocket: true }, async (socket, req) => {
    const query = InstrumentTradeWsQuerySchema.safeParse(req.query);
    const venue = query.success ? VenueIdSchema.safeParse(query.data.venue) : null;
    if (!query.success || venue == null || !venue.success) {
      send(socket, {
        type: 'error',
        code: 'INVALID_QUERY',
        message: 'Invalid instrument stream query',
      });
      socket.close(1008, 'Invalid query');
      return;
    }

    const underlying = normalizeTradeUnderlying(query.data.underlying);
    const instrument = query.data.instrument;
    const sentUids = new Set<string>();
    const sentUidOrder: string[] = [];
    const buffered: TradeEvent[] = [];
    let buffering = true;
    let closed = false;
    let release: (() => void) | null = null;

    const matches = (trade: TradeEvent) =>
      normalizeTradeUnderlying(trade.underlying) === underlying &&
      trade.venue === venue.data &&
      trade.instrument === instrument;

    const remember = (tradeUid: string): boolean => {
      if (sentUids.has(tradeUid)) return false;
      sentUids.add(tradeUid);
      sentUidOrder.push(tradeUid);
      if (sentUidOrder.length > MAX_SENT_UIDS) {
        const oldest = sentUidOrder.shift();
        if (oldest != null) sentUids.delete(oldest);
      }
      return true;
    };

    const sendTrade = (trade: TradeEvent) => {
      const enriched = enrichLiveTrade(trade);
      if (!remember(enriched.tradeUid)) return;
      send(socket, { type: 'trade', trade: enriched });
    };

    const unsubscribe = flowService.subscribe((trade) => {
      if (!matches(trade)) return;
      if (buffering) buffered.push(trade);
      else sendTrade(trade);
    });

    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      release?.();
      release = null;
    };
    socket.once('close', cleanup);

    try {
      release = await flowService.acquire(underlying);
      if (closed) {
        release();
        release = null;
        return;
      }

      const snapshot: FlowTrade[] = [];
      for (const trade of flowService.getTrades(underlying)) {
        if (!matches(trade)) continue;
        const enriched = enrichLiveTrade(trade);
        if (remember(enriched.tradeUid)) snapshot.push(enriched);
      }
      send(socket, { type: 'snapshot', generatedAt: Date.now(), trades: snapshot });

      buffering = false;
      for (const trade of buffered) sendTrade(trade);
      buffered.length = 0;
    } catch (error) {
      req.log.warn(
        { err: String(error), underlying, venue: venue.data, instrument },
        'instrument trade stream failed',
      );
      send(socket, {
        type: 'error',
        code: 'STREAM_FAILED',
        message: 'Unable to start live trade stream',
      });
      cleanup();
      socket.close(1011, 'Stream failed');
    }
  });
}

function send(
  socket: { readyState: number; send: (data: string) => void },
  message: InstrumentTradeWsServerMessage,
): void {
  if (socket.readyState === WS_OPEN) socket.send(JSON.stringify(message));
}
