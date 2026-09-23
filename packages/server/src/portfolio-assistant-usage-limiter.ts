import type { PortfolioAssistantStore } from '@oggregator/db';

import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';

export interface DailyAssistantUsage {
  used: number;
  limit: number;
  remaining: number;
}

export class PortfolioAssistantUsageLimiter {
  private readonly activeUsers = new Set<string>();
  private activeRequests = 0;

  constructor(
    private readonly store: PortfolioAssistantStore,
    private readonly configuration: PortfolioAssistantConfiguration,
    private readonly now: () => number = Date.now,
  ) {}

  async getPortfolioAssistantDailyUsage(userId: string): Promise<DailyAssistantUsage> {
    const now = new Date(this.now());
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const used = await this.store.countCompletedPortfolioAssistantQuestionsSince(userId, since);
    return {
      used,
      limit: this.configuration.dailyQuestionLimit,
      remaining: Math.max(0, this.configuration.dailyQuestionLimit - used),
    };
  }

  async requirePortfolioAssistantQuestionAllowance(userId: string): Promise<void> {
    const usage = await this.getPortfolioAssistantDailyUsage(userId);
    if (usage.remaining === 0)
      throw new PortfolioAssistantServiceError(
        'daily_limit_reached',
        'Daily Portfolio Assistant question limit reached.',
        429,
        false,
      );
  }

  acquirePortfolioAssistantConcurrencyLease(userId: string): () => void {
    if (
      this.activeUsers.has(userId) ||
      this.activeRequests >= this.configuration.maxConcurrentRequests
    ) {
      throw new PortfolioAssistantServiceError(
        'concurrent_request',
        'Another Portfolio Assistant response is already in progress.',
        409,
        true,
      );
    }
    this.activeUsers.add(userId);
    this.activeRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeUsers.delete(userId);
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    };
  }
}
