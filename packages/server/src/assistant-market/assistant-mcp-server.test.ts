import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';

import { AssistantMcpHandler, buildAssistantMcpServer, buildAssistantMcpTools } from './assistant-mcp-server.js';
import { AssistantMarketDataReader } from './market-data-reader.js';
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
  handler: new AssistantMcpHandler(buildAssistantMcpTools(reader, library), log),
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
