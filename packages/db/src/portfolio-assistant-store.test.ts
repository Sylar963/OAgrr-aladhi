import { describe, expect, it } from 'vitest';

import { NoopPortfolioAssistantStore } from './portfolio-assistant-store.js';

describe('NoopPortfolioAssistantStore', () => {
  it('fails closed without persistence', async () => {
    const store = new NoopPortfolioAssistantStore();
    expect(store.enabled).toBe(false);
    expect(await store.getUserEntitlement('user', 'portfolio_assistant_beta')).toBeNull();
    expect(
      await store.redeemFeatureInvite('user', 'portfolio_assistant_beta', 'digest', new Date()),
    ).toBe('invalid');
    await expect(
      store.createPortfolioAssistantThread({
        id: crypto.randomUUID(),
        userId: 'user',
        accountId: 'account',
        source: 'manual',
        underlying: null,
        title: 'New chat',
        createdAt: new Date(),
      }),
    ).rejects.toThrow('persistence unavailable');
  });
});
