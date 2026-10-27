import type { PortfolioAssistantStreamEvent } from '@oggregator/protocol';

export async function* relayAssistantEvents<T>(
  work: (emit: (event: PortfolioAssistantStreamEvent) => void) => Promise<T>,
): AsyncGenerator<PortfolioAssistantStreamEvent, T> {
  const queue: PortfolioAssistantStreamEvent[] = [];
  let wake: (() => void) | undefined;
  let settled = false;
  const result = work((event) => {
    queue.push(event);
    wake?.();
  });
  void result.then(() => { settled = true; wake?.(); }, () => { settled = true; wake?.(); });
  while (!settled || queue.length > 0) {
    const event = queue.shift();
    if (event) yield event;
    else await new Promise<void>((resolve) => { wake = resolve; });
  }
  return await result;
}
