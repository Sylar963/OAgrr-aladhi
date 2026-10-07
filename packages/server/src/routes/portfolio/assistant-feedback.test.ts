import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { feedbackService, conversationService, authenticateUserMock } = vi.hoisted(() => ({
  feedbackService: {
    submitFeedback: vi.fn(),
    listThreadFeedback: vi.fn(),
    forgetThread: vi.fn(),
  },
  conversationService: { deletePortfolioAssistantThread: vi.fn() },
  authenticateUserMock: vi.fn(),
}));

vi.mock('../../portfolio-assistant-services.js', () => ({
  portfolioAssistantAccessService: {},
  portfolioAssistantConversationService: conversationService,
  portfolioAssistantFeedbackService: feedbackService,
  portfolioAssistantMemoryService: {},
}));

vi.mock('../../user-service.js', () => ({ authenticateUser: authenticateUserMock }));

import { PortfolioAssistantServiceError } from '../../portfolio-assistant-model-gateway.js';
import { portfolioAssistantRoutes } from './assistant.js';

const ALICE = { id: 'usr_alice', clerkUserId: 'c_a', accountId: 'acct_a', label: 'alice' };
const THREAD = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '11111111-1111-4111-8111-111111111111';
const VOTE_URL = `/api/portfolio/assistant/threads/${THREAD}/messages/${MESSAGE}/feedback`;
const SAVED = {
  messageId: MESSAGE,
  vote: 'down',
  reasons: ['wrong_numbers'],
  note: 'strike is off',
  updatedAt: 1,
};

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(portfolioAssistantRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('portfolio assistant feedback routes', () => {
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
    ['POST', VOTE_URL],
    ['GET', `/api/portfolio/assistant/threads/${THREAD}/feedback`],
  ] as const)('rejects anonymous %s %s', async (method, url) => {
    const res = await app.inject({
      method,
      url,
      payload: method === 'POST' ? { vote: 'up' } : undefined,
    });
    expect(res.statusCode).toBe(401);
    expect(feedbackService.submitFeedback).not.toHaveBeenCalled();
    expect(feedbackService.listThreadFeedback).not.toHaveBeenCalled();
  });

  it('records a vote for the authenticated user', async () => {
    feedbackService.submitFeedback.mockResolvedValue(SAVED);
    const res = await app.inject({
      method: 'POST',
      url: VOTE_URL,
      headers: { authorization: 'Bearer alice' },
      payload: { vote: 'down', reasons: ['wrong_numbers'], note: 'strike is off' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(SAVED);
    expect(feedbackService.submitFeedback).toHaveBeenCalledWith('usr_alice', THREAD, MESSAGE, {
      vote: 'down',
      reasons: ['wrong_numbers'],
      note: 'strike is off',
    });
  });

  it.each([
    [{ vote: 'meh' }],
    [{ vote: 'up', reasons: ['too_long'] }],
    [{ vote: 'down', reasons: ['bogus'] }],
    [{ vote: 'down', reasons: ['refused', 'refused'] }],
    [{ vote: 'down', note: 'x'.repeat(201) }],
  ])('rejects an invalid body %j', async (payload) => {
    const res = await app.inject({
      method: 'POST',
      url: VOTE_URL,
      headers: { authorization: 'Bearer alice' },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(feedbackService.submitFeedback).not.toHaveBeenCalled();
  });

  it('rejects a malformed message id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/portfolio/assistant/threads/${THREAD}/messages/not-a-uuid/feedback`,
      headers: { authorization: 'Bearer alice' },
      payload: { vote: 'up' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the message is not the caller', async () => {
    feedbackService.submitFeedback.mockRejectedValue(
      new PortfolioAssistantServiceError('thread_not_found', 'Message not found.', 404, false),
    );
    const res = await app.inject({
      method: 'POST',
      url: VOTE_URL,
      headers: { authorization: 'Bearer alice' },
      payload: { vote: 'up' },
    });
    expect(res.statusCode).toBe(404);
  });

  it("lists the caller's votes for a thread", async () => {
    feedbackService.listThreadFeedback.mockResolvedValue([SAVED]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/portfolio/assistant/threads/${THREAD}/feedback`,
      headers: { authorization: 'Bearer alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ feedback: [SAVED] });
    expect(feedbackService.listThreadFeedback).toHaveBeenCalledWith('usr_alice', THREAD);
  });

  it('drops buffered votes only when the thread was actually deleted', async () => {
    conversationService.deletePortfolioAssistantThread
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const url = `/api/portfolio/assistant/threads/${THREAD}`;
    const headers = { authorization: 'Bearer alice' };
    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(204);
    expect(feedbackService.forgetThread).toHaveBeenCalledWith('usr_alice', THREAD);
    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(404);
    expect(feedbackService.forgetThread).toHaveBeenCalledTimes(1);
  });
});
