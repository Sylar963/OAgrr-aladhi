import { NewsCursorError, reportedMacroHeadline } from '@oggregator/core';
import { NewsDeliveryQuerySchema, NewsMacroResponseSchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { newsDelivery } from '../services.js';
export async function newsMacroRoute(app: FastifyInstance) {
  app.get('/news/macro', async (req, reply) => {
    const query = NewsDeliveryQuerySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_macro_query' });
    reply.header('Cache-Control', 'no-store');
    try {
      const page = newsDelivery.page(query.data.after, query.data.limit);
      const items = page.events.map(reportedMacroHeadline).filter((item) => item !== null);
      return NewsMacroResponseSchema.parse({
        ...page,
        events: undefined,
        items,
        scanned: page.events.length,
        generatedAt: Date.now(),
        mode: 'reported-headline-figures',
        scheduledCalendarAvailable: false,
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
