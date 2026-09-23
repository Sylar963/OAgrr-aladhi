import { type IntervalHistogram, monitorEventLoopDelay } from 'node:perf_hooks';
import type { FastifyBaseLogger } from 'fastify';

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

function isProviderFailure(code: string): boolean {
  return code.startsWith('provider_') || code === 'invalid_provider_response';
}

function toMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
