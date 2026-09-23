import { describe, expect, it } from 'vitest';

import { parseUpstreamEvents } from './hermes-portfolio-assistant-gateway.js';

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
