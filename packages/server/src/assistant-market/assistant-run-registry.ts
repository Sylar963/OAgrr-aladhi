import { createHash } from 'node:crypto';

export type AssistantToolCallOutcome = 'ok' | 'rejected_input' | 'failed' | 'timeout';

export type AssistantToolAttribution =
  | { mode: 'exact'; requestId: string }
  | { mode: 'single_active'; requestId: string }
  | { mode: 'ambiguous'; candidateCount: number }
  | { mode: 'none' };

export interface AssistantRunStart {
  requestId: string;
  userIdHash: string;
  threadId: string;
  portfolioRef: string | null;
}

export interface AssistantRunToolSummary {
  total: number;
  byTool: Record<string, number>;
  failed: number;
  timedOut: number;
  rejected: number;
  exactAttributed: number;
}

export interface AssistantRunRegistryOptions {
  maxActiveRuns?: number;
  ttlMs?: number;
  now?: () => number;
}

interface ActiveRun extends AssistantRunStart {
  startedAt: number;
  tools: AssistantRunToolSummary;
}

const DEFAULT_MAX_ACTIVE_RUNS = 256;
const DEFAULT_RUN_TTL_MS = 15 * 60_000;
const REF_HASH_LENGTH = 12;

export function hashPortfolioRef(ref: string): string {
  return createHash('sha256').update(ref).digest('hex').slice(0, REF_HASH_LENGTH);
}

export function emptyAssistantRunToolSummary(): AssistantRunToolSummary {
  return { total: 0, byTool: {}, failed: 0, timedOut: 0, rejected: 0, exactAttributed: 0 };
}

/**
 * Process-local map of in-flight assistant chat runs, so MCP tool calls made by Hermes can be
 * attributed back to the chat request. Bounded by run count and age; nothing is persisted.
 */
export class AssistantRunRegistry {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly refToRequest = new Map<string, string>();
  private readonly maxActiveRuns: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: AssistantRunRegistryOptions = {}) {
    this.maxActiveRuns = options.maxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS;
    this.ttlMs = options.ttlMs ?? DEFAULT_RUN_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  begin(run: AssistantRunStart): void {
    this.evictExpired();
    this.remove(run.requestId);
    while (this.runs.size >= this.maxActiveRuns) {
      const oldest = this.runs.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    this.runs.set(run.requestId, {
      ...run,
      startedAt: this.now(),
      tools: emptyAssistantRunToolSummary(),
    });
    if (run.portfolioRef != null) this.refToRequest.set(run.portfolioRef, run.requestId);
  }

  // A ref that maps to no active run comes from a finished run or an outside caller such as
  // the eval harness, so it is never attributed to whichever run happens to be active.
  attribute(portfolioRef: string | null): AssistantToolAttribution {
    this.evictExpired();
    if (portfolioRef != null) {
      const requestId = this.refToRequest.get(portfolioRef);
      return requestId == null ? { mode: 'none' } : { mode: 'exact', requestId };
    }
    if (this.runs.size === 0) return { mode: 'none' };
    if (this.runs.size > 1) return { mode: 'ambiguous', candidateCount: this.runs.size };
    const only = this.runs.keys().next().value;
    return only === undefined ? { mode: 'none' } : { mode: 'single_active', requestId: only };
  }

  recordToolCall(
    attribution: AssistantToolAttribution,
    tool: string,
    outcome: AssistantToolCallOutcome,
  ): void {
    if (attribution.mode !== 'exact' && attribution.mode !== 'single_active') return;
    const run = this.runs.get(attribution.requestId);
    if (run == null) return;
    const tools = run.tools;
    tools.total += 1;
    tools.byTool[tool] = (tools.byTool[tool] ?? 0) + 1;
    if (outcome === 'failed') tools.failed += 1;
    else if (outcome === 'timeout') tools.timedOut += 1;
    else if (outcome === 'rejected_input') tools.rejected += 1;
    if (attribution.mode === 'exact') tools.exactAttributed += 1;
  }

  finish(requestId: string): AssistantRunToolSummary | null {
    const run = this.runs.get(requestId);
    if (run == null) return null;
    this.remove(requestId);
    return run.tools;
  }

  get activeCount(): number {
    return this.runs.size;
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [requestId, run] of this.runs) {
      if (run.startedAt > cutoff) break;
      this.remove(requestId);
    }
  }

  private remove(requestId: string): void {
    const run = this.runs.get(requestId);
    if (run == null) return;
    this.runs.delete(requestId);
    if (run.portfolioRef != null && this.refToRequest.get(run.portfolioRef) === requestId) {
      this.refToRequest.delete(run.portfolioRef);
    }
  }
}
