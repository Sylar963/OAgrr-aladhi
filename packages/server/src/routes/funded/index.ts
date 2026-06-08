import type { FastifyInstance } from 'fastify';
import { isFundedEnabled } from '../../funded-services.js';
import { requireUser } from '../../user-service.js';
import { fundedRunsRoute } from './runs.js';
import { fundedTemplatesRoute } from './templates.js';

export async function fundedRoutes(app: FastifyInstance): Promise<void> {
  if (!isFundedEnabled()) return;
  app.addHook('onRequest', requireUser());
  await fundedTemplatesRoute(app);
  await fundedRunsRoute(app);
}
