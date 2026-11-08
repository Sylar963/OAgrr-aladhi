import { parseArgs } from 'node:util';
import { z } from 'zod';

import { readPortfolioAssistantConfiguration } from '../portfolio-assistant-configuration.js';
import { HermesPortfolioAssistantGateway } from '../hermes-portfolio-assistant-gateway.js';

const RpcResponseSchema = z.object({ result: z.unknown() });
const ToolListSchema = z.object({ tools: z.array(z.object({ name: z.string() })) });
const ArgsSchema = z.object({
  'transport-only': z.boolean().default(false),
  'wait-ms': z.coerce.number().int().min(0).max(60_000).default(0),
});
const REQUIRED_TOOLS = [
  'oggregator_list_underlyings',
  'oggregator_option_chain',
  'oggregator_evaluate_structure',
  'oggregator_preview_thalex_margin',
];

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    'transport-only': { type: 'boolean' },
    'wait-ms': { type: 'string' },
  } });
  const args = ArgsSchema.parse(values);
  const token = process.env['OGG_ASSISTANT_MCP_TOKEN']?.trim();
  const port = z.coerce.number().int().min(1).max(65535).parse(process.env['OGG_ASSISTANT_MCP_PORT'] ?? 3191);
  if (!token) throw new Error('OGG_ASSISTANT_MCP_TOKEN is required');
  let rpcId = 0;
  const rpc = async (method: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`MCP ${method} returned HTTP ${response.status}`);
    return RpcResponseSchema.parse(await response.json()).result;
  };
  const deadline = Date.now() + args['wait-ms'];
  while (true) {
    try {
      await rpc('ping');
      const list = ToolListSchema.parse(await rpc('tools/list'));
      const names = new Set(list.tools.map((tool) => tool.name));
      if (REQUIRED_TOOLS.some((name) => !names.has(name))) throw new Error('MCP registry is missing required portfolio tools');
      process.stdout.write(`MCP transport ready; ${list.tools.length} tools registered.\n`);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, deadline - Date.now())));
    }
  }
  if (args['transport-only']) return;
  const configuration = readPortfolioAssistantConfiguration(process.env);
  const completed = new Set<string>();
  const gateway = new HermesPortfolioAssistantGateway(configuration, fetch, undefined, (event) => {
    if (event.status === 'completed' && /(?:^|__)oggregator_list_underlyings$/.test(event.tool)) {
      completed.add(event.toolCallId);
    }
  });
  if (await gateway.checkPortfolioAssistantModelAvailability() !== 'available') throw new Error('Hermes model endpoint is unavailable');
  for await (const _event of gateway.streamPortfolioAnswer({
    threadId: 'public-tool-smoke-check',
    systemInstructions: 'This is a read-only integration check. Call oggregator_list_underlyings exactly once, then report the number of symbols. Do not use skills, memory, private data or any other tool. If the tool is absent, say so. Do not guess.',
    contextMessage: 'There is no private portfolio in this integration check.',
    conversationMessages: [{ role: 'user', content: 'Fetch the listed underlyings from the Oggregator tool now.' }],
  }, AbortSignal.timeout(configuration.requestTimeoutMs))) {}
  if (completed.size === 0) {
    throw new Error('Hermes answered without a completed Oggregator tool call. Check MCP discovery, profile toolsets and connection recovery.');
  }
  process.stdout.write(`Hermes integration ready; ${completed.size} Oggregator tool call(s) completed.\n`);
}

await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Portfolio assistant check failed'}\n`);
  process.exitCode = 1;
});
