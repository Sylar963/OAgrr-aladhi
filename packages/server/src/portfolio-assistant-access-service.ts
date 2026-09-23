import { createHmac } from 'node:crypto';

import type { PortfolioAssistantStore } from '@oggregator/db';
import type { PortfolioAssistantAccess } from '@oggregator/protocol';

import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import type { PortfolioAssistantModelGateway } from './portfolio-assistant-model-gateway.js';
import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';

const FEATURE_KEY = 'portfolio_assistant_beta';

export class PortfolioAssistantAccessService {
  private availability: { value: 'available' | 'unavailable'; checkedAt: number } | null = null;

  constructor(
    private readonly store: PortfolioAssistantStore,
    private readonly configuration: PortfolioAssistantConfiguration,
    private readonly gateway: PortfolioAssistantModelGateway,
    private readonly now: () => number = Date.now,
  ) {}

  async getPortfolioAssistantAccess(userId: string): Promise<PortfolioAssistantAccess> {
    if (!this.configuration.enabled) return this.disabled('feature_disabled');
    if (!this.store.enabled) return this.disabled('persistence_unavailable');
    const entitlement = await this.store.getUserEntitlement(userId, FEATURE_KEY);
    const active =
      entitlement?.status === 'enabled' &&
      (entitlement.expiresAt == null || entitlement.expiresAt.getTime() > this.now());
    if (!active) return this.disabled('invite_required');
    const availability = await this.getProviderAvailability();
    if (availability === 'unavailable')
      return this.disabled('provider_unavailable', entitlement?.expiresAt ?? null);
    const used = await this.store.countCompletedPortfolioAssistantQuestionsSince(
      userId,
      startOfUtcDay(this.now()),
    );
    return {
      enabled: true,
      reason: 'entitled',
      expiresAt: entitlement?.expiresAt?.getTime() ?? null,
      dailyQuestionLimit: this.configuration.dailyQuestionLimit,
      dailyQuestionsUsed: used,
    };
  }

  async requirePortfolioAssistantEntitlement(userId: string): Promise<void> {
    if (!this.configuration.enabled) {
      throw new PortfolioAssistantServiceError(
        'assistant_not_enabled',
        'Portfolio Assistant is temporarily unavailable.',
        403,
        false,
      );
    }
    if (!this.store.enabled) {
      throw new PortfolioAssistantServiceError(
        'persistence_unavailable',
        'Portfolio Assistant history storage is unavailable.',
        503,
        true,
      );
    }
    const entitlement = await this.store.getUserEntitlement(userId, FEATURE_KEY);
    const active =
      entitlement?.status === 'enabled' &&
      (entitlement.expiresAt == null || entitlement.expiresAt.getTime() > this.now());
    if (!active) {
      throw new PortfolioAssistantServiceError(
        'assistant_not_enabled',
        'Portfolio Assistant beta access is required.',
        403,
        false,
      );
    }
  }

  async redeemPortfolioAssistantInvite(
    userId: string,
    rawInviteCode: string,
  ): Promise<PortfolioAssistantAccess> {
    if (!this.configuration.enabled) return this.disabled('feature_disabled');
    if (!this.store.enabled || !this.configuration.inviteHashSecret)
      return this.disabled('persistence_unavailable');
    const digest = createHmac('sha256', this.configuration.inviteHashSecret)
      .update(rawInviteCode.trim())
      .digest('hex');
    const result = await this.store.redeemFeatureInvite(
      userId,
      FEATURE_KEY,
      digest,
      new Date(this.now()),
    );
    if (result === 'invalid' || result === 'expired') {
      throw new PortfolioAssistantServiceError(
        'assistant_not_enabled',
        result === 'expired'
          ? 'This beta invite is expired or fully redeemed.'
          : 'This beta invite is invalid.',
        403,
        false,
      );
    }
    return this.getPortfolioAssistantAccess(userId);
  }

  private disabled(
    reason: PortfolioAssistantAccess['reason'],
    expiresAt: Date | null = null,
  ): PortfolioAssistantAccess {
    return {
      enabled: false,
      reason,
      expiresAt: expiresAt?.getTime() ?? null,
      dailyQuestionLimit: null,
      dailyQuestionsUsed: null,
    };
  }

  private async getProviderAvailability(): Promise<'available' | 'unavailable'> {
    const now = this.now();
    if (this.availability && now - this.availability.checkedAt < 30_000)
      return this.availability.value;
    const value = await this.gateway.checkPortfolioAssistantModelAvailability();
    this.availability = { value, checkedAt: now };
    return value;
  }
}

function startOfUtcDay(nowMs: number): Date {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
