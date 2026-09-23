import {
  CreatePortfolioAssistantThreadRequestSchema,
  type PortfolioAssistantStreamEvent,
  PortfolioAssistantStreamEventSchema,
  RedeemPortfolioAssistantInviteRequestSchema,
  SendPortfolioAssistantMessageRequestSchema,
} from '@oggregator/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { PortfolioAssistantServiceError } from '../../portfolio-assistant-model-gateway.js';
import { authenticateUser } from '../../user-service.js';

const ThreadParamsSchema = z.object({ threadId: z.string().uuid() });
const ThreadListQuerySchema = z.object({
  source: z.string().min(1),
  underlying: z.string().trim().min(1).max(32).optional(),
});
const MessageListQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^[0-9]+$/)
    .optional(),
});

async function requireAuthenticatedPortfolioAssistantUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (request.user) return;
  const user = await authenticateUser(request, reply);
  if (!user) {
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Invalid or missing Authorization bearer token',
      retryable: false,
    });
    return;
  }
  request.user = user;
}

function sendAssistantError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof PortfolioAssistantServiceError) {
    return reply
      .status(error.statusCode)
      .send({ error: error.code, message: error.message, retryable: error.retryable });
  }
  reply.log.error({ err: error }, 'portfolio assistant request failed');
  return reply.status(500).send({
    error: 'internal_error',
    message: 'Portfolio Assistant request failed.',
    retryable: true,
  });
}

function frame(event: PortfolioAssistantStreamEvent): string {
  return `event: portfolio_assistant\ndata: ${JSON.stringify(PortfolioAssistantStreamEventSchema.parse(event))}\n\n`;
}

export async function portfolioAssistantRoutes(app: FastifyInstance) {
  const { portfolioAssistantAccessService, portfolioAssistantConversationService } = await import(
    '../../portfolio-assistant-services.js'
  );
  const strictAuth = { onRequest: requireAuthenticatedPortfolioAssistantUser };

  app.get('/portfolio/assistant/access', strictAuth, async (request, reply) => {
    try {
      return await portfolioAssistantAccessService.getPortfolioAssistantAccess(request.user!.id);
    } catch (error) {
      return sendAssistantError(reply, error);
    }
  });

  app.post(
    '/portfolio/assistant/invites/redeem',
    {
      ...strictAuth,
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const parsed = RedeemPortfolioAssistantInviteRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .status(400)
          .send({ error: 'invalid_body', message: 'Invite code is invalid.', retryable: false });
      try {
        return await portfolioAssistantAccessService.redeemPortfolioAssistantInvite(
          request.user!.id,
          parsed.data.code,
        );
      } catch (error) {
        return sendAssistantError(reply, error);
      }
    },
  );

  app.post('/portfolio/assistant/threads', strictAuth, async (request, reply) => {
    const parsed = CreatePortfolioAssistantThreadRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: 'invalid_body', message: 'Thread context is invalid.', retryable: false });
    try {
      const thread = await portfolioAssistantConversationService.createPortfolioAssistantThread(
        request.user!,
        parsed.data,
      );
      return reply.status(201).send(thread);
    } catch (error) {
      return sendAssistantError(reply, error);
    }
  });

  app.get('/portfolio/assistant/threads', strictAuth, async (request, reply) => {
    const parsed = ThreadListQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: 'invalid_query', message: 'Thread query is invalid.', retryable: false });
    try {
      const threads = await portfolioAssistantConversationService.listPortfolioAssistantThreads(
        request.user!.id,
        parsed.data.source,
        parsed.data.underlying ?? null,
      );
      return { threads };
    } catch (error) {
      return sendAssistantError(reply, error);
    }
  });

  app.get('/portfolio/assistant/threads/:threadId/messages', strictAuth, async (request, reply) => {
    const params = ThreadParamsSchema.safeParse(request.params);
    const query = MessageListQuerySchema.safeParse(request.query);
    if (!params.success || !query.success)
      return reply
        .status(400)
        .send({ error: 'invalid_query', message: 'Message query is invalid.', retryable: false });
    try {
      return await portfolioAssistantConversationService.loadPortfolioAssistantMessages(
        request.user!.id,
        params.data.threadId,
        query.data.cursor,
      );
    } catch (error) {
      return sendAssistantError(reply, error);
    }
  });

  app.post(
    '/portfolio/assistant/threads/:threadId/messages',
    {
      ...strictAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = ThreadParamsSchema.safeParse(request.params);
      const body = SendPortfolioAssistantMessageRequestSchema.safeParse(request.body);
      if (!params.success || !body.success)
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Message request is invalid.',
          retryable: false,
        });

      const controller = new AbortController();
      const onAborted = () => controller.abort();
      const onClosed = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once('aborted', onAborted);
      reply.raw.once('close', onClosed);
      const iterator = portfolioAssistantConversationService
        .streamPortfolioAssistantReply(
          request.user!,
          params.data.threadId,
          body.data,
          controller.signal,
        )
        [Symbol.asyncIterator]();

      let first: IteratorResult<PortfolioAssistantStreamEvent>;
      try {
        first = await iterator.next();
      } catch (error) {
        request.raw.off('aborted', onAborted);
        reply.raw.off('close', onClosed);
        return sendAssistantError(reply, error);
      }

      reply.headers({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const responseHeaders = reply.getHeaders();
      for (const [name, value] of Object.entries(responseHeaders)) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      reply.hijack();
      reply.raw.writeHead(200);
      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed) reply.raw.write(': keep-alive\n\n');
      }, 15_000);
      heartbeat.unref?.();

      try {
        if (!first.done) reply.raw.write(frame(first.value));
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          reply.raw.write(frame(next.value));
        }
      } catch (error) {
        request.log.error({ err: error }, 'portfolio assistant stream failed');
        if (!reply.raw.destroyed) {
          reply.raw.write(
            frame({
              type: 'error',
              code: 'internal_error',
              message: 'Portfolio Assistant stream failed.',
              retryable: true,
            }),
          );
        }
      } finally {
        clearInterval(heartbeat);
        request.raw.off('aborted', onAborted);
        reply.raw.off('close', onClosed);
        if (!reply.raw.destroyed) reply.raw.end();
      }
    },
  );

  app.delete('/portfolio/assistant/threads/:threadId', strictAuth, async (request, reply) => {
    const params = ThreadParamsSchema.safeParse(request.params);
    if (!params.success)
      return reply
        .status(400)
        .send({ error: 'invalid_query', message: 'Thread ID is invalid.', retryable: false });
    try {
      const deleted = await portfolioAssistantConversationService.deletePortfolioAssistantThread(
        request.user!.id,
        params.data.threadId,
      );
      if (!deleted)
        return reply.status(404).send({
          error: 'thread_not_found',
          message: 'Conversation not found.',
          retryable: false,
        });
      return reply.status(204).send();
    } catch (error) {
      return sendAssistantError(reply, error);
    }
  });
}
