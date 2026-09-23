import { timingSafeEqual } from 'node:crypto';

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AssistantMarketDataReader, MarketReadResult } from './market-data-reader.js';
import type { OptionsLibrary } from './options-library.js';

const SERVER_INFO = { name: 'oggregator-market', version: '1.0.0' };
const FALLBACK_PROTOCOL_VERSION = '2025-06-18';

const JsonRpcMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
type JsonRpcMessage = z.infer<typeof JsonRpcMessageSchema>;

const ToolCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

const underlying = z
  .string()
  .min(1)
  .max(20)
  .describe('Underlying symbol, e.g. BTC or ETH. Use oggregator_list_underlyings for the full list.');

interface ToolDefinition {
  name: string;
  description: string;
  input: z.ZodObject;
  run: (args: never) => Promise<unknown>;
}

function tool<Schema extends z.ZodObject>(definition: {
  name: string;
  description: string;
  input: Schema;
  run: (args: z.infer<Schema>) => Promise<unknown>;
}): ToolDefinition {
  return definition as unknown as ToolDefinition;
}

class ToolInputError extends Error {}

function unwrap<T>(result: MarketReadResult<T>): T {
  if (!result.ok) throw new ToolInputError(result.error);
  return result.data;
}

export function buildAssistantMcpTools(
  reader: AssistantMarketDataReader,
  library: OptionsLibrary,
): ToolDefinition[] {
  return [
    tool({
      name: 'oggregator_list_underlyings',
      description: 'List every underlying with listed options across Oggregator venues.',
      input: z.object({}),
      run: async () => unwrap(await reader.listUnderlyings()),
    }),
    tool({
      name: 'oggregator_list_expiries',
      description: 'List option expiries for an underlying with exact expiry time and days to expiry.',
      input: z.object({ underlying }),
      run: async (args) => unwrap(await reader.listExpiries(args.underlying)),
    }),
    tool({
      name: 'oggregator_market_overview',
      description:
        'Spot, 24h range, DVOL, 7d/30d ATM IV and percentiles, realized volatility, IV-RV premium, expected moves, range state and volatility regime for an underlying.',
      input: z.object({ underlying }),
      run: async (args) => unwrap(await reader.marketOverview(args.underlying)),
    }),
    tool({
      name: 'oggregator_option_chain',
      description:
        'Cross-venue option chain for one expiry: per strike and side, best bid/ask with venue and size, median mid, IV, delta, gamma, theta, vega, open interest and volume. Filter by strike range to keep results focused.',
      input: z.object({
        underlying,
        expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Expiry date YYYY-MM-DD.'),
        minStrike: z.number().positive().optional(),
        maxStrike: z.number().positive().optional(),
        side: z.enum(['call', 'put', 'both']).optional().describe('Defaults to both.'),
      }),
      run: async (args) =>
        unwrap(
          await reader.optionChain(args.underlying, args.expiry, {
            minStrike: args.minStrike,
            maxStrike: args.maxStrike,
            side: args.side,
          }),
        ),
    }),
    tool({
      name: 'oggregator_vol_surface',
      description:
        'Implied volatility term structure and smile per expiry: 10/25-delta put, ATM, 25/10-delta call IV, 25-delta risk reversal and butterfly, plus per-venue ATM IV for venue comparison.',
      input: z.object({
        underlying,
        includeVenueAtm: z.boolean().optional().describe('Defaults to true.'),
      }),
      run: async (args) =>
        unwrap(
          await reader.volSurface(args.underlying, {
            includeVenueAtm: args.includeVenueAtm ?? true,
          }),
        ),
    }),
    tool({
      name: 'oggregator_iv_history',
      description:
        'Constant-maturity (7d/30d/60d/90d) ATM IV, 25-delta risk reversal and butterfly history: current values, rank and percentile, window min/max, and daily closes.',
      input: z.object({
        underlying,
        windowDays: z.union([z.literal(30), z.literal(90)]).optional().describe('Defaults to 30.'),
      }),
      run: async (args) => unwrap(await reader.ivHistory(args.underlying, args.windowDays ?? 30)),
    }),
    tool({
      name: 'oggregator_gamma_exposure',
      description:
        'Dealer gamma exposure (GEX) across all expiries: net GEX and the strikes with the largest positive and negative gamma, in USD millions.',
      input: z.object({ underlying }),
      run: async (args) => unwrap(await reader.gammaExposure(args.underlying)),
    }),
    tool({
      name: 'oggregator_block_flow',
      description:
        'Recent institutional block trades: venue, direction, strategy, legs, notional and premium.',
      input: z.object({
        underlying,
        limit: z.number().int().min(1).max(50).optional().describe('Defaults to 20.'),
      }),
      run: async (args) => unwrap(await reader.blockFlow(args.underlying, args.limit ?? 20)),
    }),
    tool({
      name: 'search_options_library',
      description:
        'Full-text search over the indexed options trading books (volatility trading, pricing, strategies, risk). Returns passages with book and PDF page for citation. Use specific terms, e.g. "gamma scalping realized volatility" or "calendar spread vega".',
      input: z.object({
        query: z.string().min(2).max(300),
        limit: z.number().int().min(1).max(8).optional().describe('Defaults to 5.'),
      }),
      run: async (args) => {
        const hits = library.search(args.query, args.limit ?? 5);
        if (hits == null) throw new ToolInputError('The options library has not been indexed yet.');
        return {
          books: library.listBooks(),
          results: hits,
          usage:
            'Paraphrase and cite as (Author, Title, PDF p. N). Quote at most a sentence or two.',
        };
      },
    }),
  ];
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export class AssistantMcpHandler {
  private readonly tools: Map<string, ToolDefinition>;

  constructor(
    tools: ToolDefinition[],
    private readonly log: FastifyBaseLogger,
  ) {
    this.tools = new Map(tools.map((definition) => [definition.name, definition]));
  }

  async handle(message: JsonRpcMessage): Promise<Record<string, unknown> | null> {
    if (message.id === undefined) return null;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result });
    const fail = (code: number, text: string) => ({
      jsonrpc: '2.0',
      id: message.id,
      error: { code, message: text },
    });
    switch (message.method) {
      case 'initialize': {
        const requested = z
          .object({ protocolVersion: z.string() })
          .safeParse(message.params).data?.protocolVersion;
        return reply({
          protocolVersion: requested ?? FALLBACK_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Read-only Oggregator market data and options library search. IV values are fractions.',
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({
          tools: [...this.tools.values()].map((definition) => ({
            name: definition.name,
            description: definition.description,
            inputSchema: z.toJSONSchema(definition.input),
            annotations: { readOnlyHint: true, openWorldHint: false },
          })),
        });
      case 'tools/call':
        return reply(await this.callTool(message.params));
      default:
        return fail(-32601, `Method not found: ${message.method}`);
    }
  }

  private async callTool(params: unknown) {
    const parsed = ToolCallParamsSchema.safeParse(params);
    if (!parsed.success) return this.errorResult('Invalid tool call parameters.');
    const definition = this.tools.get(parsed.data.name);
    if (!definition) return this.errorResult(`Unknown tool: ${parsed.data.name}`);
    const args = definition.input.safeParse(parsed.data.arguments ?? {});
    if (!args.success) return this.errorResult(`Invalid arguments: ${z.prettifyError(args.error)}`);
    const startedAt = Date.now();
    try {
      const data = await definition.run(args.data as never);
      this.log.info(
        { tool: definition.name, durationMs: Date.now() - startedAt },
        'assistant mcp tool call',
      );
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) {
      if (error instanceof ToolInputError) return this.errorResult(error.message);
      this.log.error({ err: error, tool: definition.name }, 'assistant mcp tool failed');
      return this.errorResult('The tool failed unexpectedly.');
    }
  }

  private errorResult(text: string) {
    return { content: [{ type: 'text', text }], isError: true };
  }
}

export interface AssistantMcpServerOptions {
  token: string;
  port: number;
  handler: AssistantMcpHandler;
  log: FastifyBaseLogger;
}

export function buildAssistantMcpServer(
  options: Omit<AssistantMcpServerOptions, 'port'>,
): FastifyInstance {
  const server = Fastify({ loggerInstance: options.log.child({ component: 'assistant-mcp' }) });
  server.addHook('onRequest', async (request, reply) => {
    if (!tokenMatches(request.headers.authorization, options.token)) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });
  for (const method of ['GET', 'DELETE'] as const) {
    server.route({
      method,
      url: '/mcp',
      handler: async (_request, reply) => reply.status(405).header('Allow', 'POST').send(),
    });
  }
  server.post('/mcp', async (request, reply) => {
    const batch = Array.isArray(request.body);
    const raw: unknown[] = batch ? (request.body as unknown[]) : [request.body];
    const responses: Record<string, unknown>[] = [];
    for (const item of raw) {
      const parsed = JsonRpcMessageSchema.safeParse(item);
      if (!parsed.success) {
        responses.push({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Invalid Request' },
        });
        continue;
      }
      const response = await options.handler.handle(parsed.data);
      if (response) responses.push(response);
    }
    if (responses.length === 0) return reply.status(202).send();
    return reply.type('application/json').send(batch ? responses : responses[0]);
  });
  return server;
}

export async function startAssistantMcpServer(
  options: AssistantMcpServerOptions,
): Promise<FastifyInstance> {
  const server = buildAssistantMcpServer(options);
  await server.listen({ port: options.port, host: '127.0.0.1' });
  return server;
}
