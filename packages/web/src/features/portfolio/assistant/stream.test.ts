import { describe, expect, it } from 'vitest';

import { parsePortfolioAssistantEventStream } from './stream';

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('parsePortfolioAssistantEventStream', () => {
  it('preserves UTF-8 split across byte chunks and ignores heartbeats', async () => {
    const encoder = new TextEncoder();
    const unicodeText = 'risk \u{1F95A}';
    const frame = `: keep-alive\n\nevent: portfolio_assistant\ndata: {"type":"text_delta","assistantMessageId":"550e8400-e29b-41d4-a716-446655440000","delta":"${unicodeText}"}\n\n`;
    const bytes = encoder.encode(frame);
    const unicodeStart = frame.indexOf('\u{1F95A}');
    const prefixBytes = encoder.encode(frame.slice(0, unicodeStart)).length;
    const events = [];
    for await (const event of parsePortfolioAssistantEventStream(
      byteStream([
        bytes.slice(0, prefixBytes + 1),
        bytes.slice(prefixBytes + 1, prefixBytes + 3),
        bytes.slice(prefixBytes + 3),
      ]),
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: 'text_delta',
        assistantMessageId: '550e8400-e29b-41d4-a716-446655440000',
        delta: unicodeText,
      },
    ]);
  });

  it('rejects an unknown event shape', async () => {
    const stream = byteStream([new TextEncoder().encode('data: {"type":"tool_call"}\n\n')]);
    await expect(async () => {
      for await (const _event of parsePortfolioAssistantEventStream(stream)) {
      }
    }).rejects.toThrow('invalid stream event');
  });
});
