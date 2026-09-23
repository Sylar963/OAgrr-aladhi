import {
  NoopPortfolioAssistantStore,
  type PortfolioAssistantStore,
  PostgresPortfolioAssistantStore,
} from '@oggregator/db';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import {
  AssistantMcpHandler,
  buildAssistantMcpTools,
  startAssistantMcpServer,
} from './assistant-market/assistant-mcp-server.js';
import { AssistantMarketDataReader } from './assistant-market/market-data-reader.js';
import { OptionsLibrary } from './assistant-market/options-library.js';
import { HermesPortfolioAssistantGateway } from './hermes-portfolio-assistant-gateway.js';
import { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import { readPortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import { PortfolioAssistantContextBuilder } from './portfolio-assistant-context-builder.js';
import { PortfolioAssistantConversationService } from './portfolio-assistant-conversation-service.js';
import { PortfolioAssistantPromptBuilder } from './portfolio-assistant-prompt-builder.js';
import { PortfolioAssistantUsageLimiter } from './portfolio-assistant-usage-limiter.js';

const configuration = readPortfolioAssistantConfiguration(process.env);
const store: PortfolioAssistantStore = process.env['DATABASE_URL']
  ? PostgresPortfolioAssistantStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopPortfolioAssistantStore();

if (configuration.enabled && !store.enabled) {
  throw new Error('DATABASE_URL is required when Portfolio Assistant is enabled');
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const assistantMarketDataReader = new AssistantMarketDataReader();
export const optionsLibrary = new OptionsLibrary(
  resolve(repoRoot, process.env['OPTIONS_LIBRARY_PATH'] ?? 'docs/options-library.sqlite'),
);
let assistantMcpServer: FastifyInstance | null = null;

const gateway = new HermesPortfolioAssistantGateway(configuration);
export const portfolioAssistantAccessService = new PortfolioAssistantAccessService(
  store,
  configuration,
  gateway,
);
const contextBuilder = new PortfolioAssistantContextBuilder(
  configuration,
  assistantMarketDataReader,
);
const promptBuilder = new PortfolioAssistantPromptBuilder();
const usageLimiter = new PortfolioAssistantUsageLimiter(store, configuration);

export const portfolioAssistantConversationService = new PortfolioAssistantConversationService(
  store,
  configuration,
  portfolioAssistantAccessService,
  contextBuilder,
  promptBuilder,
  gateway,
  usageLimiter,
);

let retentionTimer: ReturnType<typeof setInterval> | null = null;

export function startPortfolioAssistantRetentionCleanup(log: FastifyBaseLogger): void {
  if (!store.enabled || retentionTimer) return;
  const cleanup = async () => {
    try {
      const cutoff = new Date(Date.now() - configuration.retentionDays * 24 * 60 * 60 * 1_000);
      const deleted = await store.deleteExpiredPortfolioAssistantThreads(cutoff, 500);
      if (deleted > 0) {
        log.info({ deleted }, 'expired portfolio assistant threads deleted');
      }
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'portfolio assistant retention cleanup failed',
      );
    }
  };
  retentionTimer = setInterval(() => void cleanup(), 60 * 60 * 1_000);
  retentionTimer.unref?.();
  void cleanup();
}

export function bindAssistantMarketData(app: FastifyInstance): void {
  assistantMarketDataReader.bind(async (url) => {
    const response = await app.inject({ method: 'GET', url });
    let body: unknown = null;
    try {
      body = response.json();
    } catch {
      body = null;
    }
    return { statusCode: response.statusCode, body };
  });
}

const MIN_MCP_TOKEN_LENGTH = 32;

export async function startAssistantMcpFromEnv(log: FastifyBaseLogger): Promise<void> {
  const token = process.env['OGG_ASSISTANT_MCP_TOKEN']?.trim();
  if (!token || assistantMcpServer) return;
  if (token.length < MIN_MCP_TOKEN_LENGTH) {
    log.error('OGG_ASSISTANT_MCP_TOKEN is too short; assistant MCP server not started');
    return;
  }
  const port = Number(process.env['OGG_ASSISTANT_MCP_PORT'] ?? 3191);
  try {
    assistantMcpServer = await startAssistantMcpServer({
      token,
      port,
      log,
      handler: new AssistantMcpHandler(
        buildAssistantMcpTools(assistantMarketDataReader, optionsLibrary),
        log,
      ),
    });
    log.info({ port }, 'assistant MCP server listening on loopback');
  } catch (error) {
    log.error({ err: error, port }, 'assistant MCP server failed to start');
  }
}

export async function disposePortfolioAssistantServices(): Promise<void> {
  if (assistantMcpServer) {
    await assistantMcpServer.close();
    assistantMcpServer = null;
  }
  optionsLibrary.close();
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
  await store.dispose();
}
