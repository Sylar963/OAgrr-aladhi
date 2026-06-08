import { InitPaperAccountRequestSchema, type PaperAccountDto } from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_LABEL, DEFAULT_INITIAL_CASH_USD } from '@oggregator/trading';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAccount, paperTradingStore, resetAccount } from '../../trading-services.js';
import { resolveScope } from './scope.js';

function persistenceUnavailable() {
  return { error: 'persistence_unavailable', message: 'DATABASE_URL not set' };
}

// Label fallback used only when no persisted account row exists yet (toDto).
// On a scoped funded-run account the label comes from the persisted row.
function fallbackLabel(req: FastifyRequest): string {
  return req.user ? `${req.user.label}'s Account` : DEFAULT_ACCOUNT_LABEL;
}

export async function paperAccountRoute(app: FastifyInstance) {
  app.get('/paper/account', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const id = await resolveScope(req, reply);
    if (id === null) return reply;
    const account = await getAccount(id);
    return toDto(account, id, fallbackLabel(req));
  });

  app.post('/paper/account/init', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = InitPaperAccountRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const id = await resolveScope(req, reply);
    if (id === null) return reply;
    const label = fallbackLabel(req);
    const account = await resetAccount(id, label, parsed.data.initialCashUsd);
    return toDto(account, id, label);
  });
}

function toDto(
  account: Awaited<ReturnType<typeof getAccount>>,
  fallbackId: string,
  fallbackLabel: string,
): PaperAccountDto {
  if (!account) {
    return {
      id: fallbackId,
      label: fallbackLabel,
      initialCashUsd: DEFAULT_INITIAL_CASH_USD,
      createdAt: null,
      isInitialized: false,
    };
  }
  return {
    id: account.id,
    label: account.label,
    initialCashUsd: account.initialCashUsd,
    createdAt: account.createdAt.toISOString(),
    isInitialized: true,
  };
}
