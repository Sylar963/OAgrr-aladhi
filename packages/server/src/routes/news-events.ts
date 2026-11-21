import { NewsCursorError } from '@oggregator/core';
import {
  NewsDeliveryQuerySchema,
  NewsEventsResponseSchema,
  type NewsStreamMessageSchema,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { newsDelivery, newsService } from '../services.js';
import { protectWebSocket } from '../websocket-security.js';

export async function newsEventsRoute(app: FastifyInstance) {
  app.get('/news/events', async (req, reply) => {
    const query = NewsDeliveryQuerySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_news_cursor_query' });
    try {
      const page = newsDelivery.page(query.data.after, query.data.limit);
      reply.header('Cache-Control', 'no-store');
      return NewsEventsResponseSchema.parse({
        ...page,
        generatedAt: Date.now(),
        health: newsService?.getHealth() ?? null,
      });
    } catch (error) {
      if (!(error instanceof NewsCursorError)) throw error;
      return reply
        .code(409)
        .send({
          error: 'news_resync_required',
          oldestCursor: error.oldestCursor,
          latestCursor: newsDelivery.cursor,
        });
    }
  });
}

export async function wsNewsEventsRoute(app: FastifyInstance) {
  app.get('/ws/news', { websocket: true }, (socket, req) => {
    if (!protectWebSocket(socket, req.ip)) return;
    const query = NewsDeliveryQuerySchema.safeParse(req.query);
    const send = (message: z.infer<typeof NewsStreamMessageSchema>) => {
      if (socket.readyState === 1 && socket.bufferedAmount < 2 * 1024 * 1024)
        socket.send(JSON.stringify(message));
      else socket.close(1013, 'Slow news consumer');
    };
    if (!query.success) {
      send({
        type: 'error',
        code: 'invalid_news_cursor_query',
        oldestCursor: newsDelivery.oldestCursor,
        latestCursor: newsDelivery.cursor,
      });
      socket.close(1008, 'Invalid news query');
      return;
    }
    let cursor = query.data.after ?? newsDelivery.cursor;
    let lastHeartbeat = Date.now();
    const tick = () => {
      try {
        const page = newsDelivery.page(cursor, query.data.limit);
        const health = newsService?.getHealth() ?? null;
        if (page.events.length > 0) {
          send({ type: 'events', page: { ...page, generatedAt: Date.now(), health } });
          cursor = page.nextCursor;
        } else if (Date.now() - lastHeartbeat >= 15_000) {
          send({ type: 'heartbeat', cursor, health });
          lastHeartbeat = Date.now();
        }
      } catch (error) {
        if (!(error instanceof NewsCursorError)) {
          req.log.error({ err: String(error) }, 'news delivery failed');
          socket.close(1011, 'News delivery failed');
          return;
        }
        send({
          type: 'error',
          code: 'news_resync_required',
          oldestCursor: error.oldestCursor,
          latestCursor: newsDelivery.cursor,
        });
        socket.close(1008, 'News replay required');
      }
    };
    send({ type: 'subscribed', cursor, health: newsService?.getHealth() ?? null });
    tick();
    if (socket.readyState !== 1) return;
    const timer = setInterval(tick, 1000);
    timer.unref();
    socket.once('close', () => clearInterval(timer));
  });
}
