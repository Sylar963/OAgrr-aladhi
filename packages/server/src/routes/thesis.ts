import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  ThesisCreateRequestSchema,
  ThesisEndRequestSchema,
  ThesisFlipRequestSchema,
  ThesisGateCheckRequestSchema,
  ThesisShareRequestSchema,
  ThesisTightenRequestSchema,
} from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';

import { ThesisError, type ThesisService } from '../thesis-service.js';
import { type AuthenticatedUser, getRequestAccountId, requireUser } from '../user-service.js';

export interface ThesisSharingPort {
  /** Why the user cannot publish under a username, or null when they can. */
  blocker(user: AuthenticatedUser): Promise<string | null>;
  /** A thesis write that may change the public feed. */
  changed(): void;
}

// Protocol schemas come from the protocol package's own zod instance, so type them structurally.
interface BodySchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } };
}

function parseBody<T>(schema: BodySchema<T>, body: unknown, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  void reply.status(400).send({ error: 'invalid_body', message: parsed.error.issues[0]?.message, issues: parsed.error.issues });
  return null;
}

async function handle(reply: FastifyReply, run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ThesisError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    throw err;
  }
}

const accountOf = (req: FastifyRequest) => getRequestAccountId(req, DEFAULT_ACCOUNT_ID);

export function thesisRoutes(service: ThesisService, sharing: ThesisSharingPort) {
  async function shareAs(req: FastifyRequest): Promise<string> {
    if (req.user == null) throw new ThesisError(401, 'sign_in_required', 'Sign in to share a thesis');
    const blocker = await sharing.blocker(req.user);
    if (blocker != null) throw new ThesisError(409, 'share_unavailable', blocker);
    return req.user.id;
  }

  const write = (reply: FastifyReply, run: () => Promise<unknown>) =>
    handle(reply, async () => {
      const result = await run();
      sharing.changed();
      return result;
    });

  return async function register(app: FastifyInstance): Promise<void> {
    app.addHook('onRequest', requireUser());

    app.get('/thesis', async (req, reply) => handle(reply, () => service.list(accountOf(req))));

    app.post('/thesis', async (req, reply) => {
      const body = parseBody(ThesisCreateRequestSchema, req.body, reply);
      if (body == null) return reply;
      return write(reply, async () =>
        service.create(accountOf(req), body, false, body.share ? await shareAs(req) : null),
      );
    });

    app.post('/thesis/gate/check', async (req, reply) => {
      const body = parseBody(ThesisGateCheckRequestSchema, req.body, reply);
      if (body == null) return reply;
      return handle(reply, () => service.gateCheck(accountOf(req), body));
    });

    app.post<{ Params: { id: string } }>('/thesis/:id/keep', async (req, reply) =>
      handle(reply, () => service.keep(accountOf(req), req.params.id)),
    );

    app.post<{ Params: { id: string } }>('/thesis/:id/wait', async (req, reply) =>
      handle(reply, () => service.wait(accountOf(req), req.params.id)),
    );

    app.post<{ Params: { id: string } }>('/thesis/:id/back-to-thesis', async (req, reply) =>
      handle(reply, () => service.backToThesis(accountOf(req), req.params.id)),
    );

    app.post<{ Params: { id: string } }>('/thesis/:id/flip', async (req, reply) => {
      const body = parseBody(ThesisFlipRequestSchema, req.body, reply);
      if (body == null) return reply;
      return write(reply, () => service.flip(accountOf(req), req.params.id, body));
    });

    app.post<{ Params: { id: string } }>('/thesis/:id/tighten', async (req, reply) => {
      const body = parseBody(ThesisTightenRequestSchema, req.body, reply);
      if (body == null) return reply;
      return write(reply, () => service.tighten(accountOf(req), req.params.id, body.level));
    });

    app.post<{ Params: { id: string } }>('/thesis/:id/end', async (req, reply) => {
      const body = parseBody(ThesisEndRequestSchema, req.body, reply);
      if (body == null) return reply;
      return write(reply, () => service.end(accountOf(req), req.params.id, body.note));
    });

    app.post<{ Params: { id: string } }>('/thesis/:id/share', async (req, reply) => {
      const body = parseBody(ThesisShareRequestSchema, req.body, reply);
      if (body == null) return reply;
      return write(reply, async () =>
        service.setShared(accountOf(req), req.params.id, body.shared ? await shareAs(req) : null),
      );
    });
  };
}
