import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createHermesSessionScope,
  HermesPortfolioAssistantGateway,
  parseUpstreamEvents,
} from './hermes-portfolio-assistant-gateway.js';
import type { PortfolioAssistantConfiguration } from './portfolio-assistant-configuration.js';
import type { StreamPortfolioAnswerRequest } from './portfolio-assistant-model-gateway.js';

function byteStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('Hermes stream parser', () => {
  it('parses split deltas, usage, heartbeats, and DONE', async () => {
    const events = [];
    for await (const event of parseUpstreamEvents(
      byteStream([
        ': ping\n\ndata: {"choices":[{"delta":{"cont',
        'ent":"main risk"}}]}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":3}}}\n\n',
        'data: [DONE]\n\n',
      ]),
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'text_delta', delta: 'main risk' },
      { type: 'usage', inputTokens: 12, cachedInputTokens: 3, outputTokens: 4 },
    ]);
  });

  it('rejects malformed provider JSON without exposing it', async () => {
    await expect(async () => {
      for await (const _event of parseUpstreamEvents(byteStream(['data: {secret\n\n']))) {
      }
    }).rejects.toMatchObject({ code: 'invalid_provider_response' });
  });
});

const configuration: PortfolioAssistantConfiguration = {
  enabled: true,
  apiUrl: 'http://hermes.test/v1',
  apiKey: 'test-key',
  model: 'portfolio-chat',
  requestTimeoutMs: 5_000,
  dailyQuestionLimit: 20,
  maxConcurrentRequests: 4,
  retentionDays: 30,
  inviteHashSecret: 'invite-secret',
  maxContextCharacters: 160_000,
};

interface ChatMessage {
  role: string;
  content: string;
}

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: { messages: ChatMessage[] } & Record<string, unknown>;
}

function capturingFetch(captured: CapturedRequest[]): typeof fetch {
  return async (input, init) => {
    captured.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(byteStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
}

// Mirrors gateway/platforms/api_server.py `_derive_chat_session_id` and its caller in
// api_server_openai_routes.py: system messages joined by newline, then the first user message.
function hermesDerivedSessionId(messages: ChatMessage[]): string {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');
  const firstUser = messages.find((message) => message.role === 'user')?.content ?? '';
  return `api-${createHash('sha256').update(`${system}\n${firstUser}`).digest('hex').slice(0, 16)}`;
}

function request(threadId: string): StreamPortfolioAnswerRequest {
  return {
    threadId,
    systemInstructions: 'You are Ask Hermes.',
    contextMessage: '<oggregator_portfolio_context version="1">{}</oggregator_portfolio_context>',
    conversationMessages: [{ role: 'user', content: 'hi' }],
  };
}

async function send(
  gateway: HermesPortfolioAssistantGateway,
  input: StreamPortfolioAnswerRequest,
): Promise<void> {
  for await (const _event of gateway.streamPortfolioAnswer(input, new AbortController().signal)) {
  }
}

describe('Hermes session isolation', () => {
  it('gives two threads with the same opening message different Hermes sessions', async () => {
    const captured: CapturedRequest[] = [];
    const gateway = new HermesPortfolioAssistantGateway(configuration, capturingFetch(captured));

    await send(gateway, request('thread-user-a'));
    await send(gateway, request('thread-user-b'));

    const [first, second] = captured.map((entry) => entry.body.messages);
    const withoutScope = (messages: ChatMessage[]) =>
      messages.filter((message) => !message.content.startsWith('Session scope '));
    expect(hermesDerivedSessionId(withoutScope(first!))).toBe(
      hermesDerivedSessionId(withoutScope(second!)),
    );
    expect(hermesDerivedSessionId(first!)).not.toBe(hermesDerivedSessionId(second!));
  });

  it('gives every request of one thread its own Hermes session', async () => {
    const captured: CapturedRequest[] = [];
    const gateway = new HermesPortfolioAssistantGateway(configuration, capturingFetch(captured));

    await send(gateway, request('thread-1'));
    await send(gateway, request('thread-1'));

    const ids = captured.map((entry) => hermesDerivedSessionId(entry.body.messages));
    expect(new Set(ids).size).toBe(2);
  });

  it('sends the scope as a system message and keeps our history as the only history', async () => {
    const captured: CapturedRequest[] = [];
    const scopes = ['ogg_scope_first'];
    const gateway = new HermesPortfolioAssistantGateway(
      configuration,
      capturingFetch(captured),
      () => scopes.shift() ?? 'unexpected',
    );
    const input: StreamPortfolioAnswerRequest = {
      ...request('thread-1'),
      conversationMessages: [
        { role: 'user', content: 'earlier question' },
        { role: 'assistant', content: 'earlier answer' },
        { role: 'user', content: 'follow-up' },
      ],
    };

    await send(gateway, input);

    const sent = captured[0]!;
    expect(sent.url).toBe('http://hermes.test/v1/chat/completions');
    expect(sent.body.messages).toEqual([
      { role: 'system', content: 'You are Ask Hermes.' },
      {
        role: 'system',
        content:
          'Session scope ogg_scope_first: an internal routing value, not user data. Never mention it.',
      },
      { role: 'user', content: input.contextMessage },
      ...input.conversationMessages,
    ]);
    // X-Hermes-Session-Id would make Hermes replace this history with its state.db transcript.
    expect(sent.headers['x-hermes-session-id']).toBeUndefined();
    expect(sent.headers['x-hermes-session-key']).toBeUndefined();
    expect(sent.body).not.toHaveProperty('user');
    expect(JSON.stringify(sent.body)).not.toContain('thread-1');
  });

  it('mints unguessable distinct scopes', () => {
    const scopes = new Set(Array.from({ length: 100 }, () => createHermesSessionScope()));
    expect(scopes.size).toBe(100);
    for (const scope of scopes) expect(scope).toMatch(/^ogg_scope_[A-Za-z0-9_-]{22}$/);
  });
});
