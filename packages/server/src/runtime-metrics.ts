import { type IntervalHistogram, monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyBaseLogger } from 'fastify';

import type {
  AssistantToolAttribution,
  AssistantToolCallOutcome,
} from './assistant-market/assistant-run-registry.js';

const NS_PER_MS = 1_000_000;
const BYTES_PER_MB = 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export interface PortfolioAssistantRuntimeMetricsSnapshot {
  requestsTotal: Record<string, number>;
  activeRequests: number;
  responseDurationMs: {
    count: number;
    total: number;
    average: number;
    max: number;
  };
  inputTokensTotal: number;
  outputTokensTotal: number;
  providerFailuresTotal: Record<string, number>;
  toolCalls: {
    byTool: Record<string, PortfolioAssistantToolCallMetrics>;
    attributionTotal: Record<string, number>;
  };
  feedback: PortfolioAssistantFeedbackMetrics;
}

/** Counts since process start; pendingVotes is the current on-disk buffer size. */
export interface PortfolioAssistantFeedbackMetrics {
  votesTotal: Record<string, number>;
  downReasonsTotal: Record<string, number>;
  changedTotal: number;
  pendingVotes: number;
  flushedTotal: number;
  flushSkippedTotal: number;
}

export interface RecordPortfolioAssistantFeedbackInput {
  vote: string;
  reasons: readonly string[];
  previous: { vote: string; reasons: readonly string[] } | null;
}

export interface PortfolioAssistantToolCallMetrics {
  calls: number;
  failed: number;
  timedOut: number;
  rejected: number;
  durationMs: { count: number; total: number; average: number; max: number };
}

export interface RecordPortfolioAssistantToolCallInput {
  tool: string;
  outcome: AssistantToolCallOutcome;
  attribution: AssistantToolAttribution['mode'];
  durationMs: number;
}

export interface RecordPortfolioAssistantRuntimeCompletionInput {
  outcome: string;
  errorCode: string | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface RuntimeMetricsSnapshot {
  uptimeSec: number;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    arrayBuffersMb: number;
  };
  eventLoopLag: {
    p50Ms: number;
    p99Ms: number;
    maxMs: number;
    windowSec: number;
  };
  resources: {
    total: number;
    byType: Record<string, number>;
  };
  portfolioAssistant: PortfolioAssistantRuntimeMetricsSnapshot;
}

let histogram: IntervalHistogram | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
// Histogram resets every heartbeat; window starts at that boundary so the
// p50/p99/max numbers in /api/health describe a known interval rather than
// "everything since boot" (which would mask recent spikes).
let windowStartMs = Date.now();

let portfolioAssistantMetrics = createPortfolioAssistantMetrics();

function createPortfolioAssistantMetrics(): PortfolioAssistantRuntimeMetricsSnapshot {
  return {
    requestsTotal: {},
    activeRequests: 0,
    responseDurationMs: { count: 0, total: 0, average: 0, max: 0 },
    inputTokensTotal: 0,
    outputTokensTotal: 0,
    providerFailuresTotal: {},
    toolCalls: { byTool: {}, attributionTotal: {} },
    feedback: {
      votesTotal: {},
      downReasonsTotal: {},
      changedTotal: 0,
      pendingVotes: 0,
      flushedTotal: 0,
      flushSkippedTotal: 0,
    },
  };
}

export function startRuntimeMetrics(log: FastifyBaseLogger): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  windowStartMs = Date.now();

  heartbeatTimer = setInterval(() => {
    const snap = getRuntimeMetricsSnapshot();
    log.info(snap, 'runtime metrics heartbeat');
    histogram?.reset();
    windowStartMs = Date.now();
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

export function disposeRuntimeMetrics(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (histogram) {
    histogram.disable();
    histogram = null;
  }
  portfolioAssistantMetrics = createPortfolioAssistantMetrics();
}

export function getRuntimeMetricsSnapshot(): RuntimeMetricsSnapshot {
  const mem = process.memoryUsage();
  const resources = process.getActiveResourcesInfo();
  const byType: Record<string, number> = {};
  for (const name of resources) {
    byType[name] = (byType[name] ?? 0) + 1;
  }

  const p50Ns = histogram?.percentile(50) ?? 0;
  const p99Ns = histogram?.percentile(99) ?? 0;
  const maxNs = histogram?.max ?? 0;

  return {
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMb: toMb(mem.rss),
      heapUsedMb: toMb(mem.heapUsed),
      heapTotalMb: toMb(mem.heapTotal),
      externalMb: toMb(mem.external),
      arrayBuffersMb: toMb(mem.arrayBuffers),
    },
    eventLoopLag: {
      p50Ms: round1(p50Ns / NS_PER_MS),
      p99Ms: round1(p99Ns / NS_PER_MS),
      maxMs: round1(maxNs / NS_PER_MS),
      windowSec: Math.round((Date.now() - windowStartMs) / 1000),
    },
    resources: {
      total: resources.length,
      byType,
    },
    portfolioAssistant: {
      requestsTotal: { ...portfolioAssistantMetrics.requestsTotal },
      activeRequests: portfolioAssistantMetrics.activeRequests,
      responseDurationMs: { ...portfolioAssistantMetrics.responseDurationMs },
      inputTokensTotal: portfolioAssistantMetrics.inputTokensTotal,
      outputTokensTotal: portfolioAssistantMetrics.outputTokensTotal,
      providerFailuresTotal: { ...portfolioAssistantMetrics.providerFailuresTotal },
      toolCalls: {
        byTool: Object.fromEntries(
          Object.entries(portfolioAssistantMetrics.toolCalls.byTool).map(([tool, metrics]) => [
            tool,
            { ...metrics, durationMs: { ...metrics.durationMs } },
          ]),
        ),
        attributionTotal: { ...portfolioAssistantMetrics.toolCalls.attributionTotal },
      },
      feedback: {
        ...portfolioAssistantMetrics.feedback,
        votesTotal: { ...portfolioAssistantMetrics.feedback.votesTotal },
        downReasonsTotal: { ...portfolioAssistantMetrics.feedback.downReasonsTotal },
      },
    },
  };
}

export function beginPortfolioAssistantRuntimeRequest(): () => void {
  portfolioAssistantMetrics.activeRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    portfolioAssistantMetrics.activeRequests = Math.max(
      0,
      portfolioAssistantMetrics.activeRequests - 1,
    );
  };
}

export function recordPortfolioAssistantRuntimeCompletion(
  input: RecordPortfolioAssistantRuntimeCompletionInput,
): void {
  portfolioAssistantMetrics.requestsTotal[input.outcome] =
    (portfolioAssistantMetrics.requestsTotal[input.outcome] ?? 0) + 1;
  const durationMs = Math.max(0, input.durationMs);
  const duration = portfolioAssistantMetrics.responseDurationMs;
  duration.count += 1;
  duration.total += durationMs;
  duration.average = duration.total / duration.count;
  duration.max = Math.max(duration.max, durationMs);
  portfolioAssistantMetrics.inputTokensTotal += Math.max(0, input.inputTokens ?? 0);
  portfolioAssistantMetrics.outputTokensTotal += Math.max(0, input.outputTokens ?? 0);
  if (input.errorCode && isProviderFailure(input.errorCode)) {
    portfolioAssistantMetrics.providerFailuresTotal[input.errorCode] =
      (portfolioAssistantMetrics.providerFailuresTotal[input.errorCode] ?? 0) + 1;
  }
}

// Callers pass only registered tool names, which keeps the per-tool map bounded.
export function recordPortfolioAssistantToolCall(
  input: RecordPortfolioAssistantToolCallInput,
): void {
  const toolCalls = portfolioAssistantMetrics.toolCalls;
  const metrics = toolCalls.byTool[input.tool] ?? {
    calls: 0,
    failed: 0,
    timedOut: 0,
    rejected: 0,
    durationMs: { count: 0, total: 0, average: 0, max: 0 },
  };
  toolCalls.byTool[input.tool] = metrics;
  metrics.calls += 1;
  if (input.outcome === 'failed') metrics.failed += 1;
  else if (input.outcome === 'timeout') metrics.timedOut += 1;
  else if (input.outcome === 'rejected_input') metrics.rejected += 1;
  const durationMs = Math.max(0, input.durationMs);
  metrics.durationMs.count += 1;
  metrics.durationMs.total += durationMs;
  metrics.durationMs.average = metrics.durationMs.total / metrics.durationMs.count;
  metrics.durationMs.max = Math.max(metrics.durationMs.max, durationMs);
  toolCalls.attributionTotal[input.attribution] =
    (toolCalls.attributionTotal[input.attribution] ?? 0) + 1;
}

// A re-submitted vote (e.g. reasons added after a thumbs-down) counts only what changed, so
// totals approximate distinct votes rather than clicks.
export function recordPortfolioAssistantFeedback(input: RecordPortfolioAssistantFeedbackInput): void {
  const feedback = portfolioAssistantMetrics.feedback;
  if (input.previous?.vote !== input.vote) {
    feedback.votesTotal[input.vote] = (feedback.votesTotal[input.vote] ?? 0) + 1;
    if (input.previous) feedback.changedTotal += 1;
  }
  if (input.vote !== 'down') return;
  const counted = new Set(input.previous?.vote === 'down' ? input.previous.reasons : []);
  for (const reason of input.reasons) {
    if (counted.has(reason)) continue;
    feedback.downReasonsTotal[reason] = (feedback.downReasonsTotal[reason] ?? 0) + 1;
  }
}

export function setPortfolioAssistantFeedbackPending(pendingVotes: number): void {
  portfolioAssistantMetrics.feedback.pendingVotes = Math.max(0, pendingVotes);
}

export function recordPortfolioAssistantFeedbackFlush(written: number, skipped: number): void {
  portfolioAssistantMetrics.feedback.flushedTotal += Math.max(0, written);
  portfolioAssistantMetrics.feedback.flushSkippedTotal += Math.max(0, skipped);
}

function isProviderFailure(code: string): boolean {
  return code.startsWith('provider_') || code === 'invalid_provider_response';
}

function toMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
