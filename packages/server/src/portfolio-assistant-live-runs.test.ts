import type { PortfolioAssistantStreamEvent } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { PortfolioAssistantLiveRuns } from './portfolio-assistant-live-runs.js';
import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';

const MESSAGE = 'msg-1';

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

async function collect(
  iterable: AsyncIterable<PortfolioAssistantStreamEvent>,
): Promise<PortfolioAssistantStreamEvent[]> {
  const events: PortfolioAssistantStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

async function* reply(
  signal: AbortSignal,
  release: Promise<void>,
): AsyncIterable<PortfolioAssistantStreamEvent> {
  yield { type: 'message_started', assistantMessageId: MESSAGE, portfolioGeneratedAt: 1 };
  yield { type: 'text_delta', assistantMessageId: MESSAGE, delta: 'Hello' };
  if (!signal.aborted)
    await Promise.race([
      release,
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
    ]);
  if (signal.aborted) {
    yield { type: 'message_cancelled', assistantMessageId: MESSAGE };
    return;
  }
  yield { type: 'text_delta', assistantMessageId: MESSAGE, delta: ' world' };
  yield { type: 'message_completed', assistantMessageId: MESSAGE };
}

describe('PortfolioAssistantLiveRuns', () => {
  it('keeps running after a subscriber detaches and replays everything to a late subscriber', async () => {
    const runs = new PortfolioAssistantLiveRuns();
    const release = gate();
    const run = runs.start('usr', 'thread', (signal) => reply(signal, release.opened));

    const detached = new AbortController();
    const first = run.subscribe(detached.signal)[Symbol.asyncIterator]();
    expect((await first.next()).value).toMatchObject({ type: 'message_started' });
    detached.abort();
    expect(run.controller.signal.aborted).toBe(false);

    expect(runs.find('usr', 'thread')).toBe(run);
    const late = collect(run.subscribe(new AbortController().signal));
    release.open();
    const events = await late;

    expect(events.map((event) => event.type)).toEqual([
      'message_started',
      'text_delta',
      'text_delta',
      'message_completed',
    ]);
    expect(runs.find('usr', 'thread')).toBeNull();
  });

  it('cancels the model run only on explicit cancel', async () => {
    const runs = new PortfolioAssistantLiveRuns();
    const run = runs.start('usr', 'thread', (signal) => reply(signal, new Promise(() => {})));
    const events = collect(run.subscribe(new AbortController().signal));

    expect(runs.cancel('usr', 'other-thread')).toBe(false);
    expect(runs.cancel('usr')).toBe(true);

    expect((await events).at(-1)).toEqual({
      type: 'message_cancelled',
      assistantMessageId: MESSAGE,
    });
  });

  it('rethrows a failure that happens before the reply starts', async () => {
    const runs = new PortfolioAssistantLiveRuns();
    const limit = new PortfolioAssistantServiceError('daily_limit_reached', 'limit', 429, false);
    const run = runs.start('usr', 'thread', async function* () {
      throw limit;
    });

    await expect(collect(run.subscribe(new AbortController().signal))).rejects.toBe(limit);
  });

  it('allows one live run per user', () => {
    const runs = new PortfolioAssistantLiveRuns();
    runs.start('usr', 'thread', (signal) => reply(signal, new Promise(() => {})));

    expect(() =>
      runs.start('usr', 'thread-2', (signal) => reply(signal, new Promise(() => {}))),
    ).toThrow(expect.objectContaining({ code: 'concurrent_request', statusCode: 409 }));
    runs.cancel('usr');
  });
});
