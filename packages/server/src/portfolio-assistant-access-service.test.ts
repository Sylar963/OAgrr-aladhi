import type { PortfolioAssistantStore } from '@oggregator/db';
import { describe, expect, it, vi } from 'vitest';

import { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import type { PortfolioAssistantModelGateway } from './portfolio-assistant-model-gateway.js';

const configuration: PortfolioAssistantConfiguration = {
  enabled: true,
  apiUrl: 'http://127.0.0.1:8642/v1',
  apiKey: 'test-key',
  model: 'portfolio-chat',
  requestTimeoutMs: 90_000,
  dailyQuestionLimit: 20,
  maxConcurrentRequests: 4,
  retentionDays: 30,
  inviteHashSecret: 'test-secret',
  maxContextCharacters: 80_000,
};

function createStore(): PortfolioAssistantStore {
  return {
    enabled: true,
    getUserEntitlement: vi.fn().mockResolvedValue({
      userId: 'user-1',
      featureKey: 'portfolio_assistant_beta',
      status: 'enabled',
      grantedAt: new Date(0),
      expiresAt: null,
    }),
    countCompletedPortfolioAssistantQuestionsSince: vi.fn().mockResolvedValue(2),
  } as unknown as PortfolioAssistantStore;
}

describe('PortfolioAssistantAccessService', () => {
  it('allows entitled transcript access while the model provider is unavailable', async () => {
    const gateway = {
      checkPortfolioAssistantModelAvailability: vi.fn().mockResolvedValue('unavailable'),
    } as unknown as PortfolioAssistantModelGateway;
    const service = new PortfolioAssistantAccessService(createStore(), configuration, gateway);

    await expect(service.requirePortfolioAssistantEntitlement('user-1')).resolves.toBeUndefined();
    await expect(service.getPortfolioAssistantAccess('user-1')).resolves.toEqual({
      enabled: false,
      reason: 'provider_unavailable',
      expiresAt: null,
      dailyQuestionLimit: null,
      dailyQuestionsUsed: null,
    });
  });
});
