import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadMessages, authenticate, findRun } = vi.hoisted(() => ({
  loadMessages: vi.fn(), authenticate: vi.fn(), findRun: vi.fn(),
}));
vi.mock('../../portfolio-assistant-services.js', () => ({
  portfolioAssistantAccessService: {},
  portfolioAssistantConversationService: { loadPortfolioAssistantMessages: loadMessages },
  portfolioAssistantFeedbackService: {}, portfolioAssistantMemoryService: {},
}));
vi.mock('../../user-service.js', () => ({ authenticateUser: authenticate }));
vi.mock('../../portfolio-assistant-live-runs.js', () => ({
  portfolioAssistantLiveRuns: { find: findRun },
}));

import { portfolioAssistantRoutes } from './assistant.js';

const THREAD = '00000000-0000-4000-8000-000000000001';
const USER = { id: 'alice', accountId: 'account-a', label: 'Alice', clerkUserId: 'clerk-a' };
const MESSAGE = {
  messageId: '00000000-0000-4000-8000-000000000002', role: 'assistant',
  content: 'Checkpointed text', status: 'streaming', portfolioGeneratedAt: 1, createdAt: 1,
};
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.resetAllMocks();
});

async function request() {
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(portfolioAssistantRoutes, { prefix: '/api' });
  return app.inject({ method: 'GET', url: `/api/portfolio/assistant/threads/${THREAD}/messages` });
}

describe('assistant interrupted response recovery', () => {
  it('marks an orphaned saved stream incomplete while preserving its text and pagination', async () => {
    authenticate.mockResolvedValue(USER);
    loadMessages.mockResolvedValue({ messages: [MESSAGE], nextCursor: '123' });
    findRun.mockReturnValue(null);
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messages: [{ ...MESSAGE, status: 'failed' }], nextCursor: '123' });
    expect(findRun).toHaveBeenCalledWith(USER.id, THREAD);
    expect(MESSAGE.status).toBe('streaming');
  });

  it('keeps an actual live stream resumable', async () => {
    authenticate.mockResolvedValue(USER);
    loadMessages.mockResolvedValue({ messages: [MESSAGE], nextCursor: null });
    findRun.mockReturnValue({ isFinished: false });
    expect((await request()).json().messages[0].status).toBe('streaming');
  });

  it('does not alter completed or cancelled answers', async () => {
    authenticate.mockResolvedValue(USER);
    const messages = [{ ...MESSAGE, status: 'complete' }, { ...MESSAGE, status: 'cancelled' }];
    loadMessages.mockResolvedValue({ messages, nextCursor: null });
    findRun.mockReturnValue(null);
    expect((await request()).json().messages).toEqual(messages);
  });

  it('requires authentication before reading saved messages or run state', async () => {
    authenticate.mockResolvedValue(null);
    expect((await request()).statusCode).toBe(401);
    expect(loadMessages).not.toHaveBeenCalled();
    expect(findRun).not.toHaveBeenCalled();
  });
});
