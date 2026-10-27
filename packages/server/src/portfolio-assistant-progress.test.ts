import { describe, expect, it } from 'vitest';
import { relayAssistantEvents } from './portfolio-assistant-progress.js';

describe('assistant progress', () => {
  it('streams actual progress before the work finishes and propagates the result', async () => {
    let complete: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => { complete = resolve; });
    const iterator = relayAssistantEvents(async (emit) => {
      emit({ type: 'progress', stage: 'checking_quotes' });
      await waiting;
      return 42;
    });
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'progress', stage: 'checking_quotes' } });
    complete?.();
    expect(await iterator.next()).toEqual({ done: true, value: 42 });
  });

  it('propagates errors after progress instead of silently completing', async () => {
    const iterator = relayAssistantEvents(async (emit) => {
      emit({ type: 'progress', stage: 'loading_history' });
      throw new Error('history failed');
    });
    await iterator.next();
    await expect(iterator.next()).rejects.toThrow('history failed');
  });
});
