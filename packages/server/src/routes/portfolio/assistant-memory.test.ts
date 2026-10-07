import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { memoryService, authenticateUserMock } = vi.hoisted(() => ({
  memoryService: {
    getUserMemory: vi.fn(),
    forgetUserMemory: vi.fn(),
    forgetUserMemoryItem: vi.fn(),
  },
  authenticateUserMock: vi.fn(),
}));

vi.mock('../../portfolio-assistant-services.js', () => ({
  portfolioAssistantAccessService: {},
  portfolioAssistantConversationService: {},
  portfolioAssistantFeedbackService: {},
  portfolioAssistantMemoryService: memoryService,
}));

vi.mock('../../user-service.js', () => ({ authenticateUser: authenticateUserMock }));

import { PortfolioAssistantServiceError } from '../../portfolio-assistant-model-gateway.js';
import { portfolioAssistantRoutes } from './assistant.js';

const ALICE = { id: 'usr_alice', clerkUserId: 'c_a', accountId: 'acct_a', label: 'alice' };
const MEMORY = {
  items: [
    {
      id: 'mem_0a1b2c3d4e5f',
      text: 'Trades on Thalex.',
      category: 'venues',
      sourceThreadId: null,
      updatedAt: 1,
    },
  ],
  updatedAt: 1,
  lastDistilledAt: 1,
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(portfolioAssistantRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('portfolio assistant memory routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    authenticateUserMock.mockImplementation(async (request: { headers: Record<string, string> }) =>
      request.headers['authorization'] === 'Bearer alice' ? ALICE : null,
    );
  });

  it.each([
    ['GET', '/api/portfolio/assistant/memory'],
    ['DELETE', '/api/portfolio/assistant/memory'],
    ['DELETE', '/api/portfolio/assistant/memory/items/mem_0a1b2c3d4e5f'],
  ] as const)('rejects anonymous %s %s', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
    expect(memoryService.getUserMemory).not.toHaveBeenCalled();
    expect(memoryService.forgetUserMemory).not.toHaveBeenCalled();
    expect(memoryService.forgetUserMemoryItem).not.toHaveBeenCalled();
  });

  it("returns only the caller's memory", async () => {
    memoryService.getUserMemory.mockResolvedValue(MEMORY);
    const res = await app.inject({
      method: 'GET',
      url: '/api/portfolio/assistant/memory',
      headers: { authorization: 'Bearer alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(MEMORY);
    expect(memoryService.getUserMemory).toHaveBeenCalledWith('usr_alice');
  });

  it('maps a missing entitlement to its service error', async () => {
    memoryService.getUserMemory.mockRejectedValue(
      new PortfolioAssistantServiceError('assistant_not_enabled', 'Not enabled.', 403, false),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/portfolio/assistant/memory',
      headers: { authorization: 'Bearer alice' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'assistant_not_enabled' });
  });

  it('forgets everything for the caller', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/portfolio/assistant/memory',
      headers: { authorization: 'Bearer alice' },
    });
    expect(res.statusCode).toBe(204);
    expect(memoryService.forgetUserMemory).toHaveBeenCalledWith('usr_alice');
  });

  it("deletes one of the caller's items and 404s an unknown one", async () => {
    memoryService.forgetUserMemoryItem.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const headers = { authorization: 'Bearer alice' };
    const ok = await app.inject({
      method: 'DELETE',
      url: '/api/portfolio/assistant/memory/items/mem_0a1b2c3d4e5f',
      headers,
    });
    expect(ok.statusCode).toBe(204);
    expect(memoryService.forgetUserMemoryItem).toHaveBeenCalledWith('usr_alice', 'mem_0a1b2c3d4e5f');
    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/portfolio/assistant/memory/items/mem_ffffffffffff',
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects a malformed item id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/portfolio/assistant/memory/items/not-an-id',
      headers: { authorization: 'Bearer alice' },
    });
    expect(res.statusCode).toBe(400);
    expect(memoryService.forgetUserMemoryItem).not.toHaveBeenCalled();
  });
});
