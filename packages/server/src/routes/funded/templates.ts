import type { FundedTemplateDto } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { fundedStore } from '../../funded-services.js';

export async function fundedTemplatesRoute(app: FastifyInstance): Promise<void> {
  app.get('/funded/templates', async () => {
    const rows = await fundedStore.listActiveTemplates();
    const templates: FundedTemplateDto[] = rows.map((t) => ({
      id: t.id,
      name: t.name,
      routeType: t.routeType,
      testDepositMinUsd: t.testDepositMinUsd,
      testProfitTargetPct: t.testProfitTargetPct,
      testMaxDrawdownPct: t.testMaxDrawdownPct,
      fundedAbc: t.fundedAbc,
      abcFloorPct: t.abcFloorPct,
      profitSplitPct: t.profitSplitPct,
      settlementCadence: t.settlementCadence,
      maxRunsPerUser: t.maxRunsPerUser,
    }));
    return { templates };
  });
}
