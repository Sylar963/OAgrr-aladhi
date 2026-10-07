import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import Fastify from 'fastify';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { disposeRuntimeMetrics, getRuntimeMetricsSnapshot } from '../runtime-metrics.js';
import { AssistantMcpHandler, buildAssistantMcpServer, buildAssistantMcpTools } from './assistant-mcp-server.js';
import { AssistantRunRegistry, hashPortfolioRef } from './assistant-run-registry.js';
import { AssistantMarketDataReader } from './market-data-reader.js';
import { PortfolioRefStore } from './portfolio-ref.js';
import { OPTIONS_LIBRARY_SCHEMA, OptionsLibrary, buildOptionsLibraryMatchQuery } from './options-library.js';

const TOKEN = 'a'.repeat(40);
const directory = mkdtempSync(join(tmpdir(), 'ogg-library-'));
const libraryPath = join(directory, 'library.sqlite');
const database = new DatabaseSync(libraryPath);
database.exec(OPTIONS_LIBRARY_SCHEMA);
database.exec(
  "INSERT INTO books (id, title, author, language, file_name, pdf_pages, indexed_at) VALUES (1, 'Volatility Trading', 'Euan Sinclair', 'en', 'v.pdf', 10, 'now')",
);
database.exec(
  "INSERT INTO passages (text, book_id, pdf_page) VALUES ('Theta is the cost of being long gamma.', 1, 7)",
);
database.close();

const library = new OptionsLibrary(libraryPath);
const reader = new AssistantMarketDataReader(() => Date.UTC(2026, 8, 23));
reader.bind(async (path) =>
  path.startsWith('/api/expiries')
    ? { statusCode: 200, body: { underlying: 'BTC', expiries: ['2026-10-02'] } }
    : { statusCode: 503, body: { error: 'initializing', message: 'Server is loading market data' } },
);
const log = Fastify({ logger: false }).log;
const server = buildAssistantMcpServer({
  token: TOKEN,
  log,
  handler: new AssistantMcpHandler(buildAssistantMcpTools(reader, library, {
    refs: new PortfolioRefStore(),
    resolveHeldLegs: async () => [],
  }), log),
});

afterAll(async () => {
  await server.close();
  library.close();
  rmSync(directory, { recursive: true, force: true });
});

async function rpc(body: unknown, token = TOKEN) {
  return server.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

describe('assistant MCP server', () => {
  it('rejects requests without the bearer token', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'b'.repeat(40));
    expect(response.statusCode).toBe(401);
  });

  it('echoes the requested protocol version on initialize', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't' } },
    });
    expect(response.json().result).toMatchObject({
      protocolVersion: '2025-11-25',
      capabilities: { tools: {} },
    });
  });

  it('accepts notifications with 202 and no body', async () => {
    const response = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(response.statusCode).toBe(202);
  });

  it('lists only read-only tools', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = response.json().result.tools as Array<{
      name: string;
      annotations: { readOnlyHint: boolean };
    }>;
    expect(tools.map((entry) => entry.name)).toContain('oggregator_option_chain');
    expect(tools.every((entry) => entry.annotations.readOnlyHint)).toBe(true);
  });

  it('returns tool data as text content', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'oggregator_list_expiries', arguments: { underlying: 'btc' } },
    });
    const result = response.json().result;
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).expiries[0].expiry).toBe('2026-10-02');
  });

  it('surfaces upstream failures as tool errors', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'oggregator_gamma_exposure', arguments: { underlying: 'BTC' } },
    });
    const result = response.json().result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Server is loading market data');
  });

  it('rejects invalid tool arguments', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'oggregator_option_chain', arguments: { underlying: 'BTC', expiry: 'soon' } },
    });
    expect(response.json().result.isError).toBe(true);
  });

  it('searches the options library with citations', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'search_options_library', arguments: { query: 'long gamma theta' } },
    });
    const data = JSON.parse(response.json().result.content[0].text);
    expect(data.results[0]).toMatchObject({ book: 'Volatility Trading', pdfPage: 7 });
  });
});

describe('buildOptionsLibraryMatchQuery', () => {
  it('quotes terms so FTS operators in user text are inert', () => {
    expect(buildOptionsLibraryMatchQuery('gamma NEAR(theta) "vega"*')).toBe(
      '"gamma" OR "near" OR "theta" OR "vega"',
    );
    expect(buildOptionsLibraryMatchQuery('!!')).toBeNull();
  });
});

describe('assistant MCP tool call logging', () => {
  const TOOL_CALL = 'assistant mcp tool call';
  const REF = 'pref_QUFBQUFBQUFBQUFBQUFBQQ';

  function capture() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }

  function entries(log: ReturnType<typeof capture>) {
    return (['info', 'warn', 'error'] as const).flatMap((level) =>
      log[level].mock.calls.map(([fields, msg]) => ({ level, msg, ...(fields as Record<string, unknown>) })),
    );
  }

  const slowReader = new AssistantMarketDataReader(() => 0, 5);
  slowReader.bind(() => new Promise(() => {}));

  const echoTool = {
    name: 'test_echo',
    description: 'Echo the ref-bearing call.',
    input: z.object({ portfolioRef: z.string().optional() }),
    run: async () => ({ echoed: true }),
  };
  const brokenTool = {
    name: 'test_broken',
    description: 'Always throws.',
    input: z.object({}),
    run: async () => {
      throw new Error('boom');
    },
  };

  function handlerWith(log: ReturnType<typeof capture>, runs: AssistantRunRegistry | null = null) {
    const tools = [
      ...buildAssistantMcpTools(reader, library, {
        refs: new PortfolioRefStore(),
        resolveHeldLegs: async () => [],
      }),
      ...buildAssistantMcpTools(slowReader, library, {
        refs: new PortfolioRefStore(),
        resolveHeldLegs: async () => [],
      })
        .filter((definition) => definition.name === 'oggregator_list_expiries')
        .map((definition) => ({ ...definition, name: 'test_slow_expiries' })),
      echoTool,
      brokenTool,
    ];
    return new AssistantMcpHandler(tools, log as unknown as FastifyBaseLogger, runs);
  }

  const callWith = (handler: AssistantMcpHandler, params: unknown) =>
    handler.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });

  beforeEach(() => disposeRuntimeMetrics());
  afterEach(() => disposeRuntimeMetrics());

  it('logs every outcome exactly once under one message without echoing argument values', async () => {
    const log = capture();
    const handler = handlerWith(log);
    await callWith(handler, 'not an object');
    await callWith(handler, { name: 'nope' });
    await callWith(handler, { name: 'oggregator_option_chain', arguments: { underlying: 'BTC', expiry: 'soon' } });
    await callWith(handler, { name: 'oggregator_gamma_exposure', arguments: { underlying: 'BTC' } });
    await callWith(handler, { name: 'test_slow_expiries', arguments: { underlying: 'BTC' } });
    await callWith(handler, { name: 'test_broken', arguments: {} });
    const ok = await callWith(handler, { name: 'oggregator_list_expiries', arguments: { underlying: 'BTC' } });

    const logged = entries(log);
    expect(logged).toHaveLength(7);
    expect(logged.every((entry) => entry.msg === TOOL_CALL)).toBe(true);
    const byTool = (tool: string | null) => logged.find((entry) => entry.tool === tool);
    expect(byTool(null)).toMatchObject({ level: 'warn', outcome: 'rejected_input', rejection: 'invalid_params' });
    expect(byTool('nope')).toMatchObject({ level: 'warn', outcome: 'rejected_input', rejection: 'unknown_tool' });
    expect(byTool('oggregator_option_chain')).toMatchObject({
      level: 'warn',
      outcome: 'rejected_input',
      rejection: 'invalid_arguments',
    });
    expect(JSON.stringify(byTool('oggregator_option_chain'))).not.toContain('soon');
    expect(byTool('oggregator_gamma_exposure')).toMatchObject({
      level: 'warn',
      outcome: 'rejected_input',
      rejection: 'input_error',
      reason: expect.stringContaining('Server is loading market data'),
    });
    expect(byTool('test_slow_expiries')).toMatchObject({
      level: 'warn',
      outcome: 'timeout',
      reason: expect.stringContaining('timed out'),
    });
    expect(byTool('test_broken')).toMatchObject({ level: 'error', outcome: 'failed', err: expect.any(Error) });
    const success = byTool('oggregator_list_expiries');
    expect(success).toMatchObject({ level: 'info', outcome: 'ok', attribution: 'none' });
    const okText = (ok?.['result'] as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    expect(success?.resultChars).toBe(okText.length);
    expect(logged.every((entry) => typeof entry.durationMs === 'number')).toBe(true);

    const metrics = getRuntimeMetricsSnapshot().portfolioAssistant.toolCalls;
    expect(metrics.byTool['(unregistered)']).toMatchObject({ calls: 2, rejected: 2 });
    expect(metrics.byTool['nope']).toBeUndefined();
    expect(metrics.byTool['test_slow_expiries']).toMatchObject({ calls: 1, timedOut: 1 });
    expect(metrics.byTool['test_broken']).toMatchObject({ calls: 1, failed: 1 });
    expect(metrics.byTool['oggregator_list_expiries']).toMatchObject({ calls: 1, failed: 0, rejected: 0 });
    expect(metrics.attributionTotal).toEqual({ none: 7 });
  });

  it('attributes calls to chat runs and logs only a hash of the portfolioRef', async () => {
    const log = capture();
    const runs = new AssistantRunRegistry();
    const handler = handlerWith(log, runs);
    runs.begin({ requestId: 'req-1', userIdHash: 'u', threadId: 't', portfolioRef: REF });

    await callWith(handler, { name: 'test_echo', arguments: { portfolioRef: REF } });
    await callWith(handler, { name: 'oggregator_list_expiries', arguments: { underlying: 'BTC' } });
    runs.begin({ requestId: 'req-2', userIdHash: 'u2', threadId: 't2', portfolioRef: null });
    await callWith(handler, { name: 'oggregator_list_expiries', arguments: { underlying: 'BTC' } });

    const logged = entries(log);
    expect(logged.map((entry) => [entry.attribution, entry.requestId, entry.candidateRuns])).toEqual([
      ['exact', 'req-1', undefined],
      ['single_active', 'req-1', undefined],
      ['ambiguous', undefined, 2],
    ]);
    expect(logged[0]?.portfolioRefHash).toBe(hashPortfolioRef(REF));
    expect(logged[0]?.portfolioRefHash).not.toBe(REF);
    expect(JSON.stringify(logged)).not.toContain(REF);
    expect(runs.finish('req-1')).toEqual({
      total: 2,
      byTool: { test_echo: 1, oggregator_list_expiries: 1 },
      failed: 0,
      timedOut: 0,
      rejected: 0,
      exactAttributed: 1,
    });
  });
});
