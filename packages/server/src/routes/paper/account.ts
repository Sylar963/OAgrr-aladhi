import type { FastifyInstance } from 'fastify';
import {
  InitPaperAccountRequestSchema,
  type PaperAccountDto,
} from '@oggregator/protocol';
import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_ACCOUNT_LABEL,
  DEFAULT_INITIAL_CASH_USD,
} from '@oggregator/trading';
import {
  getDefaultAccount,
  paperTradingStore,
  resetDefaultAccount,
} from '../../trading-services.js';

function persistenceUnavailable() {
  return { error: 'persistence_unavailable', message: 'DATABASE_URL not set' };
}

export async function paperAccountRoute(app: FastifyInstance) {
  app.get('/paper/account', async (_req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const account = await getDefaultAccount();
    return toDto(account);
  });

  app.post('/paper/account/init', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = InitPaperAccountRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const account = await resetDefaultAccount(parsed.data.initialCashUsd);
    return toDto(account);
  });
}

function toDto(account: Awaited<ReturnType<typeof getDefaultAccount>>): PaperAccountDto {
  if (!account) {
    return {
      id: DEFAULT_ACCOUNT_ID,
      label: DEFAULT_ACCOUNT_LABEL,
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
