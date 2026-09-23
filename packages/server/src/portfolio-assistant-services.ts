import {
  NoopPortfolioAssistantStore,
  type PortfolioAssistantStore,
  PostgresPortfolioAssistantStore,
} from '@oggregator/db';
import type { FastifyBaseLogger } from 'fastify';
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

const gateway = new HermesPortfolioAssistantGateway(configuration);
export const portfolioAssistantAccessService = new PortfolioAssistantAccessService(
  store,
  configuration,
  gateway,
);
const contextBuilder = new PortfolioAssistantContextBuilder(configuration);
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

export async function disposePortfolioAssistantServices(): Promise<void> {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
  await store.dispose();
}
