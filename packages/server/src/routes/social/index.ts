import { timingSafeEqual } from 'node:crypto';
import { HandleTakenError } from '@oggregator/db';
import {
  ChatModerationRequestSchema,
  LeaderboardQuerySchema,
  UpdateSocialProfileRequestSchema,
} from '@oggregator/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  chatService,
  isSocialEnabled,
  leaderboardService,
  socialProfileService,
} from '../../social-services.js';
import { requireUser } from '../../user-service.js';
import { socialWsRoute } from './ws.js';

async function requireSocial(_req: FastifyRequest, reply: FastifyReply) {
  if (!isSocialEnabled()) {
    return reply
      .status(503)
      .send({ error: 'persistence_unavailable', message: 'Social features need DATABASE_URL' });
  }
}

function adminTokenMatches(provided: unknown): boolean {
  const expected = process.env['SOCIAL_ADMIN_TOKEN'];
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function socialRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireSocial);

  app.register(async (admin) => {
    admin.post<{ Params: { id: string } }>(
      '/social/admin/chat/messages/:id/moderate',
      { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
      async (req, reply) => {
        if (!adminTokenMatches(req.headers['x-social-admin-token'])) {
          return reply.status(401).send({ error: 'unauthorized' });
        }
        const parsed = ChatModerationRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply
            .status(400)
            .send({ error: 'invalid_request', message: parsed.error.message });
        }
        const result = await chatService.moderate(req.params.id, parsed.data);
        if (!result) return reply.status(404).send({ error: 'not_found' });
        return { ok: true, action: parsed.data.action };
      },
    );
  });

  app.register(async (user) => {
    user.addHook('onRequest', requireUser());

    user.get('/social/profile', async (req) => socialProfileService.get(req.user!.id));

    user.put(
      '/social/profile',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const parsed = UpdateSocialProfileRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: 'invalid_request',
            message: parsed.error.issues[0]?.message ?? 'Invalid profile',
          });
        }
        try {
          return await socialProfileService.update(req.user!.id, parsed.data);
        } catch (error) {
          if (error instanceof HandleTakenError) {
            return reply.status(409).send({ error: 'handle_taken', message: error.message });
          }
          throw error;
        }
      },
    );

    user.get('/social/leaderboard', async (req, reply) => {
      const parsed = LeaderboardQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid_request', message: 'Unknown period' });
      }
      return leaderboardService.get(parsed.data.period, req.user!.id);
    });
  });
}

export { socialWsRoute };
