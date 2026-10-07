import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildAssistantMcpServer } from '../assistant-market/assistant-mcp-server.js';
import { AssistantMarketDataReader } from '../assistant-market/market-data-reader.js';
import { OptionsLibrary } from '../assistant-market/options-library.js';
import { AssistantEvalFixtureSchema } from './assistant-eval-fixture.js';
import { registryObservation } from './assistant-eval-tool-log.js';
import { AssistantEvalMcp, EVAL_TOOL_SOURCES } from './eval-mcp-server.js';
import { syntheticMarketForContext } from './synthetic-market.js';

const fixture = AssistantEvalFixtureSchema.parse(
  JSON.parse(
    readFileSync(new URL('./fixtures/reference-max-loss.json', import.meta.url), 'utf8'),
  ),
);
const log = Fastify({ logger: false }).log;
const FIXTURE_NOW = Date.parse('2026-10-07T12:00:00.000Z');

const ToolTextSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1),
  isError: z.boolean().optional(),
});

function evalMcp(live: AssistantMarketDataReader | null = null) {
  return new AssistantEvalMcp({
    market: syntheticMarketForContext(fixture.context),
    library: new OptionsLibrary(join(tmpdir(), 'ogg-eval-no-library.sqlite')),
    live,
    log,
  });
}

async function call(mcp: AssistantEvalMcp, name: string, args: Record<string, unknown>) {
  const response = await mcp.handler.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const result = ToolTextSchema.parse(z.object({ result: z.unknown() }).parse(response).result);
  const text = result.content[0]?.text ?? '';
  return { isError: result.isError === true, text, json: () => JSON.parse(text) as unknown };
}

const ChainSchema = z.object({
  daysToExpiry: z.number(),
  rows: z.array(
    z.object({ strike: z.number(), side: z.string(), bestBidUsd: z.number().nullable(), bestAskUsd: z.number().nullable() }),
  ),
});

describe('eval MCP server', () => {
  it('serves the synthetic chain at the fixture clock with the numbers in the context', async () => {
    const mcp = evalMcp();
    const result = await call(mcp, 'oggregator_option_chain', {
      underlying: 'BTC',
      expiry: '2026-10-30',
      minStrike: 84_000,
      maxStrike: 86_000,
    });
    expect(result.isError).toBe(false);
    const chain = ChainSchema.parse(result.json());
    const contextChain = fixture.context.marketFacts.underlyings[0]?.heldExpiryChains.find(
      (item) => item.expiry === '2026-10-30',
    );
    const contextRow = contextChain?.rows.find((row) => row.strike === 85_000 && row.side === 'call');
    const toolRow = chain.rows.find((row) => row.strike === 85_000 && row.side === 'call');
    expect(contextRow).toBeDefined();
    expect(chain.daysToExpiry).toBe(contextChain?.daysToExpiry);
    expect(toolRow?.bestBidUsd).toBe(contextRow?.bestBidUsd);
    expect(toolRow?.bestAskUsd).toBe(contextRow?.bestAskUsd);
  });

  it('lists the synthetic expiries relative to the fixture clock', async () => {
    const result = await call(evalMcp(), 'oggregator_list_expiries', { underlying: 'BTC' });
    const listing = z
      .object({ expiries: z.array(z.object({ expiry: z.string(), daysToExpiry: z.number().nullable() })) })
      .parse(result.json());
    expect(listing.expiries[0]).toEqual({ expiry: '2026-10-09', daysToExpiry: 1.83 });
  });

  it('resolves a minted ref to the fixture book and attributes the call to the run', async () => {
    const mcp = evalMcp();
    const { portfolioRef } = mcp.beginRun({ requestId: 'r1', threadId: 't1', context: fixture.context });
    const result = await call(mcp, 'oggregator_evaluate_structure', {
      portfolioRef,
      underlying: 'BTC',
      legs: [{ expiry: '2026-10-30', strike: 90_000, right: 'call', side: 'buy', size: 1 }],
    });
    expect(result.isError).toBe(false);
    const evaluation = z
      .object({
        status: z.literal('ok'),
        evaluatedAt: z.string(),
        heldOnly: z.object({ worstLossUsd: z.number().nullable(), unboundedAfter: z.string().nullable() }),
        combined: z.object({ worstLossUsd: z.number().nullable(), upsideUnbounded: z.boolean() }),
      })
      .parse(result.json());
    expect(evaluation.evaluatedAt).toBe(new Date(FIXTURE_NOW).toISOString());
    expect({ worstLossUsd: evaluation.heldOnly.worstLossUsd, unboundedAfter: evaluation.heldOnly.unboundedAfter }).toEqual({
      worstLossUsd: fixture.context.riskBudgetFacts.worstLossUsd,
      unboundedAfter: fixture.context.riskBudgetFacts.unboundedAfter,
    });
    expect(evaluation.combined.upsideUnbounded).toBe(false);
    const usage = mcp.finishRun('r1');
    expect(usage.calls).toEqual([{ tool: 'oggregator_evaluate_structure', outcome: 'ok', attribution: 'exact' }]);
    expect(registryObservation(usage).observedTools).toEqual(['oggregator_evaluate_structure']);
  });

  it('rejects an unknown ref and does not attribute it to the active run', async () => {
    const mcp = evalMcp();
    mcp.beginRun({ requestId: 'r1', threadId: 't1', context: fixture.context });
    const result = await call(mcp, 'oggregator_evaluate_structure', {
      portfolioRef: `pref_${'x'.repeat(22)}`,
      underlying: 'BTC',
      legs: [{ expiry: '2026-10-30', strike: 90_000, right: 'call', side: 'buy', size: 1 }],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('portfolioRef is not recognised');
    const usage = mcp.finishRun('r1');
    expect(usage.calls).toEqual([]);
    expect(usage.unattributedDuringRun).toBe(1);
    expect(registryObservation(usage).unattributedCalls).toBe(1);
  });

  it('proxies live-only datasets with an eval note and refuses ones that would contradict the fixture', async () => {
    const live = new AssistantMarketDataReader();
    live.bind(async (path) =>
      path.startsWith('/api/flow')
        ? { statusCode: 200, body: { underlying: 'BTC', count: 0, trades: [] } }
        : { statusCode: 404, body: { message: 'not stubbed' } },
    );
    const mcp = evalMcp(live);
    const flow = await call(mcp, 'oggregator_trade_flow', { underlying: 'BTC' });
    expect(flow.isError).toBe(false);
    expect(z.object({ notes: z.array(z.string()) }).parse(flow.json()).notes.at(-1)).toContain(
      'Assistant eval: proxied from the live market',
    );
    const gex = await call(mcp, 'oggregator_gamma_exposure', { underlying: 'BTC' });
    expect(gex.isError).toBe(true);
    expect(gex.text).toContain('not available in the assistant eval');
    const health = await call(evalMcp(null), 'oggregator_feed_health', {});
    expect(health.isError).toBe(true);
  });

  it('declares a source for every registered tool', async () => {
    const response = await evalMcp().handler.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = z
      .object({ result: z.object({ tools: z.array(z.object({ name: z.string() })) }) })
      .parse(response)
      .result.tools.map((item) => item.name);
    expect(new Set(names)).toEqual(new Set(Object.keys(EVAL_TOOL_SOURCES)));
  });

  it('refuses to switch markets while a run is in flight and requires the bearer token', async () => {
    const mcp = evalMcp();
    mcp.beginRun({ requestId: 'r1', threadId: 't1', context: fixture.context });
    expect(() => mcp.setMarket(syntheticMarketForContext(fixture.context))).toThrow(/in flight/);
    mcp.finishRun('r1');
    expect(() => mcp.setMarket(syntheticMarketForContext(fixture.context))).not.toThrow();
    const server = buildAssistantMcpServer({ token: 'e'.repeat(40), log, handler: mcp.handler });
    const response = await server.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${'f'.repeat(40)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(response.statusCode).toBe(401);
    await server.close();
  });
});
