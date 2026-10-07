import { logger } from '@oggregator/core';
import {
  NoopPortfolioAssistantUserMemoryStore,
  type PortfolioAssistantUserMemoryStore,
} from '@oggregator/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PortfolioAssistantMemoryService } from './portfolio-assistant-memory-service.js';

const access = { requirePortfolioAssistantEntitlement: vi.fn(async () => undefined) };
const ROW = {
  userId: 'user-a',
  content: '',
  items: [
    { id: 'mem_a', text: 'Trades on Thalex.', category: 'venues', updatedAt: '2026-10-01T00:00:00.000Z' },
  ],
  lastDistilledAt: null,
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

function storeWith(load: PortfolioAssistantUserMemoryStore['loadUserMemory']) {
  return { ...new NoopPortfolioAssistantUserMemoryStore(), enabled: true, loadUserMemory: vi.fn(load) };
}

afterEach(() => vi.restoreAllMocks());

describe('PortfolioAssistantMemoryService', () => {
  it('injects facts only when memory is enabled', async () => {
    const store = storeWith(async () => ROW);
    expect(
      await new PortfolioAssistantMemoryService(store, access, false).loadUserMemoryFacts('user-a'),
    ).toBeNull();
    expect(store.loadUserMemory).not.toHaveBeenCalled();
    expect(
      await new PortfolioAssistantMemoryService(store, access, true).loadUserMemoryFacts('user-a'),
    ).toEqual({
      items: [{ category: 'venues', text: 'Trades on Thalex.' }],
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(store.loadUserMemory).toHaveBeenCalledWith('user-a');
  });

  it('keeps the chat running when the memory read fails', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const store = storeWith(async () => {
      throw new Error('db down');
    });
    expect(
      await new PortfolioAssistantMemoryService(store, access, true).loadUserMemoryFacts('user-a'),
    ).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('user-a');
  });

  it('checks the entitlement before reading and refuses deletes without storage', async () => {
    const service = new PortfolioAssistantMemoryService(
      new NoopPortfolioAssistantUserMemoryStore(),
      access,
      true,
    );
    expect(await service.getUserMemory('user-a')).toEqual({
      items: [],
      updatedAt: null,
      lastDistilledAt: null,
    });
    expect(access.requirePortfolioAssistantEntitlement).toHaveBeenCalledWith('user-a');
    await expect(service.forgetUserMemory('user-a')).rejects.toMatchObject({
      code: 'persistence_unavailable',
    });
  });
});
