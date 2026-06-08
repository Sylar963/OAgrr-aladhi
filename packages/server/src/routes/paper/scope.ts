import type { FastifyReply, FastifyRequest } from 'fastify';
import { AccountScopeError, authorizeAccountScope } from '../../user-service.js';

// Stand-in for a duplicated (array-valued) X-Paper-Account header: a non-empty
// value that can never match a real account id, so authorize denies it (403)
// instead of silently falling back to the default account.
const FORBIDDEN_SCOPE_SENTINEL = '__invalid_scope__';

/**
 * Resolve + authorize the account a paper REST request targets.
 *
 * Scope source is the `X-Paper-Account` request header (the WS path reads
 * `?accountId=` because browsers can't set WS headers).
 *
 * Returns the resolved accountId, or null after replying 403 on a foreign
 * account so callers short-circuit with `return reply`.
 */
export async function resolveScope(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const raw = request.headers['x-paper-account'];
  const header = raw === undefined || typeof raw === 'string' ? raw : FORBIDDEN_SCOPE_SENTINEL;
  try {
    return await authorizeAccountScope(request, header);
  } catch (err) {
    if (err instanceof AccountScopeError) {
      reply.status(err.statusCode).send({ error: 'forbidden', message: err.message });
      return null;
    }
    throw err;
  }
}
