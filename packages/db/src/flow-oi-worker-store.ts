import { Worker } from 'node:worker_threads';
import { type FlowOiTick, FlowOiTickSchema } from '@oggregator/protocol';
import type { DeferredLog } from './deferred-persistence.js';
import {
  type FlowOiBracket,
  FlowOiBracketSchema,
  type FlowOiWorkerRequest,
  FlowOiWorkerResponseSchema,
} from './flow-oi-worker-protocol.js';

interface Options {
  connectionString?: string | undefined;
  flushIntervalMs?: number;
  log?: DeferredLog;
  maxPendingTicks?: number;
  workerUrl?: URL;
}

type Request = FlowOiWorkerRequest extends infer T
  ? T extends FlowOiWorkerRequest
    ? Omit<T, 'id'>
    : never
  : never;

export class FlowOiWorkerStore {
  private worker: Worker | null = null;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(tick: FlowOiTick) => void>();
  private ticks: FlowOiTick[] = [];
  private inFlight: Promise<void> | null = null;
  private batchSize = 0;
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private disposed = false;
  private committedTicks = 0;
  private rejectedTicks = 0;
  private restarts = 0;
  private lastCommitAt: number | null = null;

  constructor(
    private readonly path: string,
    private readonly options: Options = {},
  ) {
    this.start();
  }

  append(tick: FlowOiTick): void {
    this.appendBatch([tick]);
  }

  appendBatch(ticks: readonly FlowOiTick[]): void {
    if (this.closing) throw new Error('FLOW OI store is closing');
    if (
      this.ticks.length + this.batchSize + ticks.length >
      (this.options.maxPendingTicks ?? 50_000)
    ) {
      this.rejectedTicks += ticks.length;
      throw new Error('FLOW OI persistence queue is full');
    }
    this.ticks.push(...ticks);
    this.schedule();
  }

  async bracket(venue: string, instrument: string, timestamp: number): Promise<FlowOiBracket> {
    return FlowOiBracketSchema.parse(
      await this.request({ method: 'bracket', venue, instrument, timestamp }),
    );
  }

  async prune(before: number): Promise<void> {
    await this.request({ method: 'prune', before });
  }

  async flush(): Promise<void> {
    await this.drain();
    await this.request({ method: 'flush' });
  }

  subscribe(listener: (tick: FlowOiTick) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus() {
    return {
      workerRunning: this.worker !== null,
      pendingTicks: this.ticks.length + this.batchSize,
      maxPendingTicks: this.options.maxPendingTicks ?? 50_000,
      committedTicks: this.committedTicks,
      rejectedTicks: this.rejectedTicks,
      restarts: this.restarts,
      lastCommitAt: this.lastCommitAt,
    };
  }

  async dispose(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      await this.drain();
      await this.request({ method: 'dispose' });
    } finally {
      this.disposed = true;
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.failPending(new Error('FLOW OI store closed'));
      await this.worker?.terminate();
      this.worker = null;
      this.listeners.clear();
    }
  }

  private schedule(delay = 100): void {
    if (this.timer || this.inFlight || this.closing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeBatch().catch((error: unknown) => {
        this.options.log?.warn(
          { err: String(error), pendingTicks: this.ticks.length },
          'FLOW OI write failed; retaining batch for retry',
        );
        this.schedule(1_000);
      });
    }, delay);
    this.timer.unref();
  }

  private writeBatch(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.ticks.length === 0) return Promise.resolve();
    const batch = this.ticks.splice(0, 5_000);
    this.batchSize = batch.length;
    const operation = this.request({ method: 'append', ticks: batch })
      .then((value) => {
        const inserted = FlowOiTickSchema.array().parse(value);
        this.committedTicks += inserted.length;
        this.lastCommitAt = Date.now();
        for (const tick of inserted)
          for (const listener of this.listeners) {
            try {
              listener(tick);
            } catch (error: unknown) {
              this.options.log?.warn({ err: String(error) }, 'FLOW OI listener failed');
            }
          }
      })
      .catch((error: unknown) => {
        this.ticks.unshift(...batch);
        throw error;
      })
      .finally(() => {
        this.batchSize = 0;
        this.inFlight = null;
      });
    this.inFlight = operation;
    void operation.then(
      () => {
        if (this.ticks.length > 0) this.schedule();
      },
      () => {},
    );
    return operation;
  }

  private async drain(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    while (this.ticks.length > 0) await this.writeBatch();
  }

  private request(request: Request): Promise<unknown> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('FLOW OI worker is unavailable'));
    if (this.pending.size >= 128) return Promise.reject(new Error('Too many FLOW OI requests'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('FLOW OI worker request timed out'));
        void worker.terminate();
      }, 15_000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ ...request, id });
    });
  }

  private start(): void {
    const worker = new Worker(
      this.options.workerUrl ?? new URL('./flow-oi-worker.js', import.meta.url),
      {
        workerData: {
          path: this.path,
          connectionString: this.options.connectionString,
          flushIntervalMs: this.options.flushIntervalMs,
        },
        execArgv: [],
      },
    );
    this.worker = worker;
    worker.on('message', (raw: unknown) => {
      const parsed = FlowOiWorkerResponseSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'warning') {
        this.options.log?.warn({}, message.message);
        return;
      }
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.type === 'error') call.reject(new Error(message.message));
      else call.resolve(message.value);
    });
    worker.on('error', (error) => {
      this.options.log?.warn({ err: String(error) }, 'FLOW OI worker failed');
    });
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.failPending(new Error(`FLOW OI worker exited (${code})`));
      if (this.closing || this.disposed) return;
      this.options.log?.warn({ code }, 'FLOW OI worker exited; restarting');
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.restarts++;
        this.start();
        if (this.ticks.length > 0) this.schedule();
      }, 1_000);
      this.restartTimer.unref();
    });
    worker.unref();
  }

  private failPending(error: Error): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
  }
}
