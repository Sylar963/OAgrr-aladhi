import { createHash } from 'node:crypto';

import { logger } from '@oggregator/core';
import type { PortfolioAssistantUserMemoryStore } from '@oggregator/db';
import type { PortfolioAssistantMemory } from '@oggregator/protocol';

import type { PortfolioAssistantAccessService } from './portfolio-assistant-access-service.js';
import {
  type PortfolioAssistantUserMemoryFacts,
  toPortfolioAssistantMemory,
  toUserMemoryFacts,
} from './portfolio-assistant-memory.js';
import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';

export class PortfolioAssistantMemoryService {
  constructor(
    private readonly store: PortfolioAssistantUserMemoryStore,
    private readonly accessService: Pick<
      PortfolioAssistantAccessService,
      'requirePortfolioAssistantEntitlement'
    >,
    private readonly injectIntoContext: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  async getUserMemory(userId: string): Promise<PortfolioAssistantMemory> {
    await this.accessService.requirePortfolioAssistantEntitlement(userId);
    return toPortfolioAssistantMemory(await this.store.loadUserMemory(userId));
  }

  // Deletes need no entitlement: a user whose access lapsed can still erase what is stored.
  async forgetUserMemory(userId: string): Promise<void> {
    this.requireStore();
    await this.store.forgetUserMemory(userId, new Date(this.now()));
  }

  async forgetUserMemoryItem(userId: string, itemId: string): Promise<boolean> {
    this.requireStore();
    return this.store.deleteUserMemoryItem(userId, itemId, new Date(this.now()));
  }

  /** Memory is optional context: a failed read leaves the chat running without it. */
  async loadUserMemoryFacts(userId: string): Promise<PortfolioAssistantUserMemoryFacts | null> {
    if (!this.injectIntoContext || !this.store.enabled) return null;
    try {
      return toUserMemoryFacts(await this.store.loadUserMemory(userId));
    } catch (error) {
      logger.warn(
        {
          userIdHash: createHash('sha256').update(userId).digest('hex'),
          err: error instanceof Error ? error.message : String(error),
        },
        'portfolio assistant memory load failed',
      );
      return null;
    }
  }

  private requireStore(): void {
    if (!this.store.enabled) {
      throw new PortfolioAssistantServiceError(
        'persistence_unavailable',
        'Assistant memory storage is unavailable.',
        503,
        true,
      );
    }
  }
}
