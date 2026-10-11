import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decodeNewsCursor, NEWS_WINDOWS } from '../news-archive.js';
import { newsArchive, newsService } from '../services.js';

const ArchiveQuerySchema = z.object({
  window: z.enum(NEWS_WINDOWS).default('latest'),
  cursor: z
    .string()
    .max(256)
    .refine((value) => decodeNewsCursor(value) !== null, 'invalid cursor')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});

export async function newsRoute(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string; since?: string } }>('/news', async (req, reply) => {
    if (!newsService) {
      return { count: 0, items: [] };
    }

    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: 'limit must be an integer in [1, 200]' });
    }

    const items = (() => {
      if (req.query.since === undefined) return newsService.getItems({ limit });
      const parsed = Date.parse(req.query.since);
      if (Number.isNaN(parsed)) return null;
      return newsService.getItems({ limit, since: parsed });
    })();

    if (items === null) {
      return reply.status(400).send({ error: 'invalid since param' });
    }
    return { count: items.length, items };
  });

  app.get('/news/archive', async (req, reply) => {
    const parsed = ArchiveQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'bad query' });
    }
    const { window, cursor, limit } = parsed.data;
    return newsArchive.page({ window, cursor: cursor ?? null, limit });
  });
}
