import type { PortfolioAssistantStreamEvent } from '@oggregator/protocol';

import { PortfolioAssistantServiceError } from './portfolio-assistant-model-gateway.js';

/**
 * A Hermes reply that outlives the HTTP request that started it. Reloading or leaving the page
 * only detaches a subscriber; the model run stops on explicit cancel or sign-out.
 */
export class PortfolioAssistantLiveRun {
  readonly controller = new AbortController();
  private readonly events: PortfolioAssistantStreamEvent[] = [];
  private readonly waiters = new Set<() => void>();
  private finished = false;
  private failure: { error: unknown } | null = null;

  constructor(
    readonly userId: string,
    readonly threadId: string,
  ) {}

  get isFinished(): boolean {
    return this.finished;
  }

  push(event: PortfolioAssistantStreamEvent): void {
    this.events.push(event);
    this.wake();
  }

  finish(failure?: { error: unknown }): void {
    this.finished = true;
    this.failure = failure ?? null;
    this.wake();
  }

  /** Replays every event so far, then follows live events until the run ends or `signal` aborts. */
  async *subscribe(signal: AbortSignal): AsyncIterable<PortfolioAssistantStreamEvent> {
    let index = 0;
    while (!signal.aborted) {
      while (index < this.events.length) yield this.events[index++]!;
      if (this.failure) throw this.failure.error;
      if (this.finished) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          this.waiters.delete(done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        this.waiters.add(done);
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}

export class PortfolioAssistantLiveRuns {
  private readonly runs = new Map<string, PortfolioAssistantLiveRun>();

  start(
    userId: string,
    threadId: string,
    produce: (signal: AbortSignal) => AsyncIterable<PortfolioAssistantStreamEvent>,
  ): PortfolioAssistantLiveRun {
    if (this.runs.has(userId))
      throw new PortfolioAssistantServiceError(
        'concurrent_request',
        'Another Portfolio Assistant response is already in progress.',
        409,
        true,
      );
    const run = new PortfolioAssistantLiveRun(userId, threadId);
    this.runs.set(userId, run);
    void (async () => {
      try {
        for await (const event of produce(run.controller.signal)) run.push(event);
        run.finish();
      } catch (error) {
        run.finish({ error });
      } finally {
        if (this.runs.get(userId) === run) this.runs.delete(userId);
      }
    })();
    return run;
  }

  find(userId: string, threadId: string): PortfolioAssistantLiveRun | null {
    const run = this.runs.get(userId);
    return run && run.threadId === threadId ? run : null;
  }

  cancel(userId: string, threadId?: string): boolean {
    const run = this.runs.get(userId);
    if (!run || (threadId !== undefined && run.threadId !== threadId)) return false;
    run.controller.abort();
    return true;
  }
}

export const portfolioAssistantLiveRuns = new PortfolioAssistantLiveRuns();
