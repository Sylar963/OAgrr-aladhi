import { randomUUID } from 'node:crypto';
import {
  type ExecutionCommand,
  type ExecutionErrorCode,
  KillScopeSchema,
  type LiveActor,
} from '@oggregator/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ExecutionClient, ExecutionResult } from '../../execution-client.js';
import {
  createLiveTraderGuard,
  type EntitlementReader,
  requireStepUp,
} from '../../live-auth.js';
import type { AuthenticatedUser } from '../../user-service.js';

export interface LiveRouteDependencies {
  env: NodeJS.ProcessEnv;
  client: Pick<ExecutionClient, 'send'> | null;
  authenticate(request: FastifyRequest): Promise<AuthenticatedUser | null>;
  entitlements: EntitlementReader;
}

const ReasonBodySchema = z.object({ reason: z.string().trim().min(1).max(280) });
const KillBodySchema = z.object({
  reason: z.string().trim().min(1).max(280).default('Kill switch from the terminal'),
  scope: z.unknown().optional(),
});
const IdempotencyHeaderSchema = z.string().uuid();

const HTTP_STATUS: Record<ExecutionErrorCode, number> = {
  invalid_request: 400,
  not_bound: 409,
  alerts_unavailable: 409,
  killed: 409,
  // The API and daemon disagree about the shared secret or clock: a deployment fault, not the user's.
  unauthenticated: 502,
  stale_request: 502,
  replayed_nonce: 502,
  internal: 500,
};

const writeLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const readLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };

function actorOf(request: FastifyRequest): LiveActor {
  const user = request.user!;
  return { clerkUserId: user.clerkUserId, accountId: user.accountId };
}

function idempotencyKey(request: FastifyRequest): string | null {
  const header = request.headers['idempotency-key'];
  if (header === undefined) return randomUUID();
  const parsed = IdempotencyHeaderSchema.safeParse(header);
  return parsed.success ? parsed.data : null;
}

function reply(res: FastifyReply, result: ExecutionResult) {
  if ('unavailable' in result) {
    return res.status(503).send({ error: 'execution_unavailable', reason: result.reason });
  }
  if (!result.ok) {
    return res.status(HTTP_STATUS[result.error.code]).send({
      error: result.error.code,
      message: result.error.message,
    });
  }
  return res.send(result.status);
}

export async function liveRoutes(app: FastifyInstance, deps: LiveRouteDependencies): Promise<void> {
  const guard = createLiveTraderGuard({
    env: deps.env,
    authenticate: deps.authenticate,
    entitlements: deps.entitlements,
  });
  const stepUp = requireStepUp(deps.env);

  async function dispatch(
    request: FastifyRequest,
    res: FastifyReply,
    command: ExecutionCommand,
  ) {
    const key = idempotencyKey(request);
    if (key === null) {
      return res.status(400).send({ error: 'invalid_idempotency_key' });
    }
    if (!deps.client) {
      request.log.error({ command: command.type }, 'execution daemon is not configured');
      return res.status(503).send({ error: 'execution_unavailable', reason: 'not_configured' });
    }
    const result = await deps.client.send(actorOf(request), command, key);
    if ('unavailable' in result && command.type === 'kill') {
      // The venue-side backstop is cancel-on-disconnect, but someone must look now.
      request.log.error({ reason: result.reason }, 'kill switch could not reach the execution daemon');
    }
    return reply(res, result);
  }

  app.get('/live/status', { onRequest: guard, config: readLimit }, (request, res) =>
    dispatch(request, res, { type: 'status' }),
  );

  // No step-up: stopping must always be one click.
  app.post<{ Body: unknown }>('/live/kill', { onRequest: guard, config: writeLimit }, (request, res) => {
    const body = KillBodySchema.safeParse(request.body ?? {});
    if (!body.success) return res.status(400).send({ error: 'invalid_request' });
    const scope = KillScopeSchema.safeParse(body.data.scope ?? { kind: 'global' });
    if (!scope.success) return res.status(400).send({ error: 'invalid_scope' });
    return dispatch(request, res, { type: 'kill', scope: scope.data, reason: body.data.reason });
  });

  app.post(
    '/live/arm',
    { onRequest: guard, preHandler: stepUp, config: writeLimit },
    (request, res) => dispatch(request, res, { type: 'arm' }),
  );

  app.post<{ Body: unknown }>('/live/disarm', { onRequest: guard, config: writeLimit }, (request, res) => {
    const body = ReasonBodySchema.safeParse(request.body);
    if (!body.success) return res.status(400).send({ error: 'invalid_request' });
    return dispatch(request, res, { type: 'disarm', reason: body.data.reason });
  });

  app.post<{ Body: unknown }>(
    '/live/reset',
    { onRequest: guard, preHandler: stepUp, config: writeLimit },
    (request, res) => {
      const body = ReasonBodySchema.safeParse(request.body);
      if (!body.success) return res.status(400).send({ error: 'invalid_request' });
      return dispatch(request, res, { type: 'reset', reason: body.data.reason });
    },
  );
}
