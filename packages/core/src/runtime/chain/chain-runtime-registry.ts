import type { WsSubscriptionRequest } from '../../core/types.js';
import { ChainRuntime, type ChainRuntimeOptions } from './chain-runtime.js';
import { chainCoverageTierForRequest, type ChainCoverageTier } from './coverage-policy.js';

const RUNTIME_IDLE_TTL_MS = 15 * 60 * 1000;
const RUNTIME_CLEANUP_INTERVAL_MS = 60 * 1000;

export interface ChainRuntimeAcquireOptions {
  activity?: 'active' | 'background';
}

export interface ChainRuntimeActivity {
  key: string;
  request: WsSubscriptionRequest;
  refCount: number;
  activeRefCount: number;
  coverageTier: ChainCoverageTier;
  lastUsedAt: number;
}

interface ChainRuntimeEntry {
  request: WsSubscriptionRequest;
  runtime: ChainRuntime;
  refCount: number;
  activeRefCount: number;
  lastUsedAt: number;
}

export interface ChainRuntimeRegistryOptions extends ChainRuntimeOptions {
  createRuntime?: (
    key: string,
    request: WsSubscriptionRequest,
    options: ChainRuntimeOptions,
  ) => ChainRuntime;
  onActivityChange?: (activity: ChainRuntimeActivity) => void;
}

function normalizeVenues(venues: WsSubscriptionRequest['venues']): WsSubscriptionRequest['venues'] {
  return [...venues].sort();
}

function runtimeKey(request: WsSubscriptionRequest): string {
  return `${request.underlying}:${request.expiry}:${normalizeVenues(request.venues).join(',')}`;
}

export class ChainRuntimeRegistry {
  private readonly entries = new Map<string, ChainRuntimeEntry>();
  private readonly createRuntime: ChainRuntimeRegistryOptions['createRuntime'];
  private readonly onActivityChange: ChainRuntimeRegistryOptions['onActivityChange'];
  private readonly runtimeOptions: ChainRuntimeOptions;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ChainRuntimeRegistryOptions = {}) {
    const { createRuntime, onActivityChange, ...runtimeOptions } = options;
    this.createRuntime = createRuntime;
    this.onActivityChange = onActivityChange;
    this.runtimeOptions = runtimeOptions;
  }

  start(): void {
    if (this.cleanupTimer != null) return;
    this.cleanupTimer = setInterval(() => {
      void this.cleanup();
    }, RUNTIME_CLEANUP_INTERVAL_MS);
  }

  async acquire(request: WsSubscriptionRequest, options: ChainRuntimeAcquireOptions = {}): Promise<{
    runtime: ChainRuntime;
    release(): Promise<void>;
  }> {
    const isActive = options.activity !== 'background';
    const normalizedRequest: WsSubscriptionRequest = {
      ...request,
      venues: normalizeVenues(request.venues),
    };
    const key = runtimeKey(normalizedRequest);
    let entry = this.entries.get(key);

    if (entry == null) {
      entry = {
        request: normalizedRequest,
        runtime:
          this.createRuntime?.(key, normalizedRequest, this.runtimeOptions) ??
          new ChainRuntime(key, normalizedRequest, this.runtimeOptions),
        refCount: 0,
        activeRefCount: 0,
        lastUsedAt: Date.now(),
      };
      this.entries.set(key, entry);
    }

    entry.refCount += 1;
    if (isActive) entry.activeRefCount += 1;
    entry.lastUsedAt = Date.now();
    this.emitActivityChange(key, entry);
    await entry.runtime.ready();

    let released = false;

    return {
      runtime: entry.runtime,
      release: async () => {
        if (released) return;
        released = true;
        const current = this.entries.get(key);
        if (current == null) return;
        current.refCount = Math.max(0, current.refCount - 1);
        if (isActive) {
          current.activeRefCount = Math.max(0, current.activeRefCount - 1);
        }
        current.lastUsedAt = Date.now();
        this.emitActivityChange(key, current);
      },
    };
  }

  listActivity(): ChainRuntimeActivity[] {
    return [...this.entries.entries()].map(([key, entry]) => this.buildActivity(key, entry));
  }

  async dispose(): Promise<void> {
    if (this.cleanupTimer != null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(entries.map(async (entry) => entry.runtime.dispose()));
  }

  private async cleanup(): Promise<void> {
    const cutoff = Date.now() - RUNTIME_IDLE_TTL_MS;
    const staleEntries = [...this.entries.entries()].filter(
      ([, entry]) => entry.refCount === 0 && entry.lastUsedAt < cutoff,
    );

    for (const [key, entry] of staleEntries) {
      this.entries.delete(key);
      await entry.runtime.dispose();
    }
  }

  private buildActivity(key: string, entry: ChainRuntimeEntry): ChainRuntimeActivity {
    return {
      key,
      request: entry.request,
      refCount: entry.refCount,
      activeRefCount: entry.activeRefCount,
      coverageTier: chainCoverageTierForRequest(entry.request, entry.activeRefCount),
      lastUsedAt: entry.lastUsedAt,
    };
  }

  private emitActivityChange(key: string, entry: ChainRuntimeEntry): void {
    this.onActivityChange?.(this.buildActivity(key, entry));
  }
}
