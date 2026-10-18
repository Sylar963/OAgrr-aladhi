import { NEWS_PIN_LIMIT, type NewsPinsResponse, PinNewsRequestSchema } from '@oggregator/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { verifyClerkToken } from '../clerk-verifier.js';
import { decodeNewsCursor, NEWS_WINDOWS } from '../news-archive.js';
import type { NewsItem } from '../news-service.js';
import { newsArchive, newsPins, newsRelevance, newsService } from '../services.js';
import { authDevBypassActive, bearerToken } from '../user-service.js';

const ArchiveQuerySchema = z.object({
  window: z.enum(NEWS_WINDOWS).default('latest'),
  cursor: z
    .string()
    .max(256)
    .refine((value) => decodeNewsCursor(value) !== null, 'invalid cursor')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});

function curatorIds(): Set<string> {
  return new Set(
    (process.env['NEWS_CURATOR_CLERK_IDS'] ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

// Pins reshape the ranking for every viewer, so only allow-listed Clerk users may change them.
// The JWT alone answers that; no users-table read is needed.
async function isCurator(req: FastifyRequest): Promise<boolean> {
  if (authDevBypassActive()) return true;
  const allowed = curatorIds();
  const token = bearerToken(req);
  if (allowed.size === 0 || !token) return false;
  const identity = await verifyClerkToken(token);
  return identity !== null && allowed.has(identity.clerkUserId);
}

function findHeadline(id: string): NewsItem | null {
  return (
    newsArchive.find(id) ??
    newsService?.getItems({ limit: 200 }).find((item) => item.id === id) ??
    null
  );
}

async function pinsResponse(req: FastifyRequest): Promise<NewsPinsResponse> {
  return { pins: [...newsPins.list()], max: NEWS_PIN_LIMIT, canEdit: await isCurator(req) };
}

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
    return { count: items.length, items: newsRelevance.annotate(items) };
  });

  app.get('/news/archive', async (req, reply) => {
    const parsed = ArchiveQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'bad query' });
    }
    const { window, cursor, limit } = parsed.data;
    const page = await newsArchive.page({ window, cursor: cursor ?? null, limit });
    return { ...page, items: newsRelevance.annotate(page.items) };
  });

  app.get('/news/pins', async (req) => pinsResponse(req));

  app.post(
    '/news/pins',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!(await isCurator(req))) return reply.status(403).send({ error: 'forbidden' });
      const parsed = PinNewsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_request', message: parsed.error.message });
      }
      const item = findHeadline(parsed.data.id);
      if (!item) return reply.status(404).send({ error: 'not_found' });
      const outcome = newsPins.add({
        id: item.id,
        text: item.text,
        url: item.url,
        handle: item.handle,
        timestamp: item.timestamp,
        pinnedAt: Date.now(),
      });
      if (outcome === 'full') {
        return reply
          .status(409)
          .send({ error: 'pin_limit', message: `Unpin a headline first (max ${NEWS_PIN_LIMIT})` });
      }
      return pinsResponse(req);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/news/pins/:id',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!(await isCurator(req))) return reply.status(403).send({ error: 'forbidden' });
      if (!newsPins.remove(req.params.id)) return reply.status(404).send({ error: 'not_found' });
      return pinsResponse(req);
    },
  );
}
