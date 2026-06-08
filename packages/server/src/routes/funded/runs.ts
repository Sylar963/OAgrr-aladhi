import type { FundedRunRow } from '@oggregator/db';
import {
  type FundedRunDetailDto,
  type FundedRunSummaryDto,
  StartFundedRunRequestSchema,
} from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import type { FastifyInstance } from 'fastify';
import { fundedEngine, fundedStore } from '../../funded-services.js';

function toSummary(r: FundedRunRow): FundedRunSummaryDto {
  return {
    id: r.id,
    templateId: r.templateId,
    routeType: r.routeType,
    status: r.status,
    depositUsd: r.depositUsd,
    abcCredited: r.abcCredited,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    endReason: r.endReason,
  };
}

function userIdOf(req: { user?: { id: string } }): string {
  return req.user?.id ?? DEFAULT_ACCOUNT_ID;
}

export async function fundedRunsRoute(app: FastifyInstance): Promise<void> {
  app.post('/funded/runs', async (req, reply) => {
    const parsed = StartFundedRunRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', message: parsed.error.message });
    }
    try {
      const run = await fundedEngine.startRun({
        userId: userIdOf(req),
        templateId: parsed.data.templateId,
        ...(parsed.data.depositUsd !== undefined && { depositUsd: parsed.data.depositUsd }),
      });
      return reply.status(201).send({ run: toSummary(run) });
    } catch (err) {
      return reply.status(422).send({
        error: 'cannot_start_run',
        message: err instanceof Error ? err.message : 'failed',
      });
    }
  });

  app.get('/funded/runs', async (req) => {
    const rows = await fundedStore.listRunsForUser(userIdOf(req));
    return { runs: rows.map(toSummary) };
  });

  app.get<{ Params: { id: string } }>('/funded/runs/:id', async (req, reply) => {
    const run = await fundedStore.getRun(req.params.id);
    if (!run || run.userId !== userIdOf(req)) {
      return reply.status(404).send({ error: 'not_found' });
    }
    const [settlements, events] = await Promise.all([
      fundedStore.listSettlements(run.id),
      fundedStore.listEvents(run.id),
    ]);
    let equityUsd: number | null = null;
    try {
      equityUsd = (await fundedEngine.getRun(run.id)) ? null : null;
    } catch {
      equityUsd = null;
    }
    const detail: FundedRunDetailDto = {
      ...toSummary(run),
      paperAccountId: run.paperAccountId,
      equityUsd,
      settlements: settlements.map((s) => ({
        settledAt: s.settledAt.toISOString(),
        equityUsd: s.equityUsd,
        abcCredited: s.abcCredited,
        cumulativeProfitUsd: s.cumulativeProfitUsd,
        traderShareUsd: s.traderShareUsd,
        drawdownPct: s.drawdownPct,
        floorBreached: s.floorBreached,
      })),
      events: events.map((e) => ({ kind: e.kind, summary: e.summary, ts: e.ts.toISOString() })),
    };
    return detail;
  });

  app.post<{ Params: { id: string } }>('/funded/runs/:id/withdraw', async (req, reply) => {
    try {
      await fundedEngine.withdrawRun(req.params.id, userIdOf(req), new Date());
      const run = await fundedStore.getRun(req.params.id);
      if (!run) return reply.status(404).send({ error: 'not_found' });
      return { run: toSummary(run) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      const code = /forbidden/i.test(msg) ? 403 : 422;
      return reply.status(code).send({ error: 'cannot_withdraw', message: msg });
    }
  });
}
