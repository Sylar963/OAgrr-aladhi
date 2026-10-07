import { logger } from '@oggregator/core';
import {
  NoopPortfolioAssistantFeedbackStore,
  NoopPortfolioAssistantStore,
  NoopPortfolioAssistantUserMemoryStore,
  type PortfolioAssistantFeedbackStore,
  type PortfolioAssistantStore,
  type PortfolioAssistantUserMemoryStore,
  PostgresPortfolioAssistantFeedbackStore,
  PostgresPortfolioAssistantStore,
  PostgresPortfolioAssistantUserMemoryStore,
} from '@oggregator/db';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import {
  createAssistantMcpHandler,
  MIN_ASSISTANT_MCP_TOKEN_LENGTH,
  startAssistantMcpServer,
} from './assistant-market/assistant-mcp-server.js';
import { AssistantMarketDataReader } from './assistant-market/market-data-reader.js';
import { AssistantRunRegistry } from './assistant-market/assistant-run-registry.js';
import { OptionsLibrary } from './assistant-market/options-library.js';
import { type PortfolioRefScope, PortfolioRefStore } from './assistant-market/portfolio-ref.js';
import { FlushSchedule } from './deferred-persistence.js';
import { HermesPortfolioAssistantGateway } from './hermes-portfolio-assistant-gateway.js';
import { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import { readPortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import { PortfolioAssistantContextBuilder } from './portfolio-assistant-context-builder.js';
import { PortfolioAssistantConversationService } from './portfolio-assistant-conversation-service.js';
import { PortfolioAssistantFeedbackBuffer } from './portfolio-assistant-feedback-buffer.js';
import { PortfolioAssistantFeedbackService } from './portfolio-assistant-feedback-service.js';
import { PortfolioAssistantMemoryDistiller } from './portfolio-assistant-memory-distiller.js';
import { PortfolioAssistantMemoryService } from './portfolio-assistant-memory-service.js';
import { PortfolioAssistantPromptBuilder } from './portfolio-assistant-prompt-builder.js';
import { PortfolioAssistantRunTelemetryCache } from './portfolio-assistant-run-telemetry.js';
import { PortfolioAssistantUsageLimiter } from './portfolio-assistant-usage-limiter.js';
import { bootstrapPortfolioForAccount, getOrCreatePortfolioRuntime } from './portfolio-services.js';
import {
  recordPortfolioAssistantFeedbackFlush,
  setPortfolioAssistantFeedbackPending,
} from './runtime-metrics.js';
import { exchangePortfolioLedgerStore } from './trading-services.js';

const configuration = readPortfolioAssistantConfiguration(process.env);
const store: PortfolioAssistantStore = process.env['DATABASE_URL']
  ? PostgresPortfolioAssistantStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopPortfolioAssistantStore();

const memoryStore: PortfolioAssistantUserMemoryStore = process.env['DATABASE_URL']
  ? PostgresPortfolioAssistantUserMemoryStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopPortfolioAssistantUserMemoryStore();

const feedbackStore: PortfolioAssistantFeedbackStore = process.env['DATABASE_URL']
  ? PostgresPortfolioAssistantFeedbackStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopPortfolioAssistantFeedbackStore();

if (configuration.enabled && !store.enabled) {
  throw new Error('DATABASE_URL is required when Portfolio Assistant is enabled');
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const assistantMarketDataReader = new AssistantMarketDataReader();
export const optionsLibrary = new OptionsLibrary(
  resolve(repoRoot, process.env['OPTIONS_LIBRARY_PATH'] ?? 'docs/options-library.sqlite'),
);
// The MCP listener runs in this process, so the refs minted for chat contexts
// resolve here without persistence.
const assistantRuns = new AssistantRunRegistry();
const portfolioRefStore = new PortfolioRefStore({ isActive: (ref) => assistantRuns.isRefActive(ref) });
let assistantMcpServer: FastifyInstance | null = null;

async function resolveHeldLegs(scope: PortfolioRefScope) {
  const underlying = scope.underlying ?? undefined;
  await bootstrapPortfolioForAccount(scope.accountId, scope.source, underlying);
  return getOrCreatePortfolioRuntime(scope.accountId, scope.source, underlying).legsWithMarks();
}

const gateway = new HermesPortfolioAssistantGateway(configuration);
export const portfolioAssistantAccessService = new PortfolioAssistantAccessService(
  store,
  configuration,
  gateway,
);
const contextBuilder = new PortfolioAssistantContextBuilder(
  configuration,
  assistantMarketDataReader,
  exchangePortfolioLedgerStore,
  Date.now,
  portfolioRefStore,
);
const promptBuilder = new PortfolioAssistantPromptBuilder();
const usageLimiter = new PortfolioAssistantUsageLimiter(store, configuration);
export const portfolioAssistantMemoryService = new PortfolioAssistantMemoryService(
  memoryStore,
  portfolioAssistantAccessService,
  configuration.memoryEnabled,
);

const runTelemetry = new PortfolioAssistantRunTelemetryCache();

export const portfolioAssistantConversationService = new PortfolioAssistantConversationService(
  store,
  configuration,
  portfolioAssistantAccessService,
  contextBuilder,
  promptBuilder,
  gateway,
  usageLimiter,
  assistantRuns,
  portfolioAssistantMemoryService,
  Date.now,
  runTelemetry,
);

const FEEDBACK_FLUSH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const FEEDBACK_MAX_PENDING_VOTES = 20_000;
const feedbackBuffer = feedbackStore.enabled
  ? new PortfolioAssistantFeedbackBuffer(
      feedbackStore,
      {
        cachePath:
          process.env['PORTFOLIO_ASSISTANT_FEEDBACK_CACHE_PATH'] ??
          '.cache/portfolio-assistant-feedback.ndjson',
        flushIntervalMs: FEEDBACK_FLUSH_INTERVAL_MS,
        maxPendingVotes: FEEDBACK_MAX_PENDING_VOTES,
      },
      logger,
    )
  : null;

export const portfolioAssistantFeedbackService = new PortfolioAssistantFeedbackService(
  feedbackStore,
  feedbackBuffer,
  portfolioAssistantAccessService,
  runTelemetry,
);

// Votes buffer on local disk and reach Neon in one upsert per daily FlushSchedule tick.
export function startPortfolioAssistantFeedbackFlush(): void {
  setPortfolioAssistantFeedbackPending(feedbackBuffer?.size ?? 0);
  feedbackBuffer?.start((result) => {
    recordPortfolioAssistantFeedbackFlush(result.written, result.skipped);
    setPortfolioAssistantFeedbackPending(result.pending);
  });
}

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

const MEMORY_DISTILLATION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MEMORY_DISTILLATION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;
let memoryDistiller: PortfolioAssistantMemoryDistiller | null = null;
let memorySchedule: FlushSchedule | null = null;

// Rides the same restart-proof daily FlushSchedule as the deferred market-data stores, so Neon
// sees one read-and-write pass a day instead of per-chat memory writes.
export function startPortfolioAssistantMemoryDistillation(log: FastifyBaseLogger): void {
  if (!configuration.enabled || !configuration.memoryEnabled || !memoryStore.enabled) return;
  if (memorySchedule) return;
  const distiller = new PortfolioAssistantMemoryDistiller(
    memoryStore,
    gateway,
    usageLimiter,
    {
      featureKey: 'portfolio_assistant_beta',
      maxUsersPerRun: configuration.memoryMaxUsersPerRun,
      concurrency: 1,
      lookbackMs: MEMORY_DISTILLATION_LOOKBACK_MS,
    },
    log,
  );
  memoryDistiller = distiller;
  memorySchedule = new FlushSchedule(
    process.env['PORTFOLIO_ASSISTANT_MEMORY_SCHEDULE_PATH'] ?? '.cache/portfolio-assistant-memory',
    MEMORY_DISTILLATION_INTERVAL_MS,
    async () => {
      const summary = await distiller.run();
      log.info(summary, 'portfolio assistant memory distillation run completed');
    },
    (error: unknown) => {
      log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'portfolio assistant memory distillation run failed',
      );
    },
  );
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

export async function startAssistantMcpFromEnv(log: FastifyBaseLogger): Promise<void> {
  const token = process.env['OGG_ASSISTANT_MCP_TOKEN']?.trim();
  if (!token || assistantMcpServer) return;
  if (token.length < MIN_ASSISTANT_MCP_TOKEN_LENGTH) {
    log.error('OGG_ASSISTANT_MCP_TOKEN is too short; assistant MCP server not started');
    return;
  }
  const port = Number(process.env['OGG_ASSISTANT_MCP_PORT'] ?? 3191);
  try {
    assistantMcpServer = await startAssistantMcpServer({
      token,
      port,
      log,
      handler: createAssistantMcpHandler({
        reader: assistantMarketDataReader,
        library: optionsLibrary,
        portfolio: { refs: portfolioRefStore, resolveHeldLegs },
        runs: assistantRuns,
        log,
      }),
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
  memorySchedule?.dispose();
  memorySchedule = null;
  memoryDistiller?.dispose();
  memoryDistiller = null;
  feedbackBuffer?.dispose();
  await store.dispose();
  await memoryStore.dispose();
  await feedbackStore.dispose();
}
