import type { FastifyInstance } from 'fastify';
import { isFundedEnabled } from '../../funded-services.js';
import { requireUser } from '../../user-service.js';
import { fundedAdminRoute } from './admin.js';
import { fundedRunsRoute } from './runs.js';
import { fundedTemplatesRoute } from './templates.js';

export async function fundedRoutes(app: FastifyInstance): Promise<void> {
  if (!isFundedEnabled()) return;
  await fundedAdminRoute(app);
  app.register(async (scoped) => {
    scoped.addHook('onRequest', requireUser());
    await fundedTemplatesRoute(scoped);
    await fundedRunsRoute(scoped);
  });
}
