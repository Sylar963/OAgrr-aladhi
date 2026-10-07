import type { AssistantRunToolSummary } from './assistant-market/assistant-run-registry.js';

export interface PortfolioAssistantRunTelemetrySummary {
  requestId: string;
  outcome: string;
  errorCode: string | null;
  durationMs: number;
  model: string;
  toolCalls: AssistantRunToolSummary;
  completedAt: number;
}

export interface PortfolioAssistantRunTelemetryCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 2_000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * Process-local map from assistant message id to its run summary, so a vote cast soon after an
 * answer carries the run's requestId and tool counts into the daily feedback batch without a
 * per-run DB write. Lost on restart; the completion log line keeps the same fields.
 */
export class PortfolioAssistantRunTelemetryCache {
  private readonly entries = new Map<string, PortfolioAssistantRunTelemetrySummary>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: PortfolioAssistantRunTelemetryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  record(assistantMessageId: string, summary: PortfolioAssistantRunTelemetrySummary): void {
    this.entries.delete(assistantMessageId);
    this.entries.set(assistantMessageId, summary);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(assistantMessageId: string): PortfolioAssistantRunTelemetrySummary | null {
    const entry = this.entries.get(assistantMessageId);
    if (!entry) return null;
    if (this.now() - entry.completedAt > this.ttlMs) {
      this.entries.delete(assistantMessageId);
      return null;
    }
    return entry;
  }

  get size(): number {
    return this.entries.size;
  }
}
