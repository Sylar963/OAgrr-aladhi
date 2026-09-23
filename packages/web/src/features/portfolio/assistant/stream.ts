import {
  type PortfolioAssistantStreamEvent,
  PortfolioAssistantStreamEventSchema,
} from '@oggregator/protocol';

export async function* parsePortfolioAssistantEventStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<PortfolioAssistantStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (!frame.trim() || frame.trimStart().startsWith(':')) continue;
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const parsed = PortfolioAssistantStreamEventSchema.safeParse(JSON.parse(data) as unknown);
        if (!parsed.success)
          throw new Error('Portfolio Assistant returned an invalid stream event.');
        yield parsed.data;
      }
      if (done) break;
    }
    if (buffer.trim() && !buffer.trimStart().startsWith(':'))
      throw new Error('Portfolio Assistant stream ended mid-event.');
  } finally {
    reader.releaseLock();
  }
}
