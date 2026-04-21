import type { FastifyInstance } from 'fastify';
import { createUser } from '../../user-service.js';

export async function paperAuthRoute(app: FastifyInstance) {
  app.post('/paper/auth/register', async (req, reply) => {
    const { label } = req.body as { label?: string };
    if (!label || typeof label !== 'string' || label.length < 1) {
      return reply.status(400).send({ error: 'invalid_label', message: 'Label is required' });
    }
    try {
      const { user, account } = await createUser(label.trim());
      return {
        userId: user.id,
        apiKey: user.apiKey,
        accountId: user.accountId,
        label: user.label,
        account: {
          id: account.id,
          label: account.label,
          initialCashUsd: account.initialCashUsd,
          createdAt: account.createdAt.toISOString(),
        },
      };
    } catch (error) {
      console.error('Failed to create user:', error);
      return reply.status(500).send({ error: 'internal_error', message: 'Failed to create user' });
    }
  });
}