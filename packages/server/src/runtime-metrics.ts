import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import type { FastifyBaseLogger } from 'fastify';

const NS_PER_MS = 1_000_000;
const BYTES_PER_MB = 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;
const EVENT_LOOP_LAG_ALERT_MS = 500;
const EVENT_LOOP_LAG_BUCKET_MS = 100;

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
    over500Count: number;
    buckets: Record<string, number>;
  };
  resources: {
    total: number;
    byType: Record<string, number>;
  };
}

let histogram: IntervalHistogram | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
// Histogram resets every heartbeat; window starts at that boundary so the
// p50/p99/max numbers in /api/health describe a known interval rather than
// "everything since boot" (which would mask recent spikes).
let windowStartMs = Date.now();
let eventLoopLagBuckets: Record<string, number> = {};
let eventLoopLagOver500Count = 0;

export function startRuntimeMetrics(log: FastifyBaseLogger): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  windowStartMs = Date.now();
  eventLoopLagBuckets = {};
  eventLoopLagOver500Count = 0;

  heartbeatTimer = setInterval(() => {
    const snap = getRuntimeMetricsSnapshot();
    recordEventLoopLagSample(snap.eventLoopLag.maxMs);
    if (snap.eventLoopLag.maxMs >= EVENT_LOOP_LAG_ALERT_MS) {
      log.warn({ eventLoopLag: snap.eventLoopLag }, 'event-loop-lag');
    }
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
  eventLoopLagBuckets = {};
  eventLoopLagOver500Count = 0;
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
      over500Count: eventLoopLagOver500Count,
      buckets: { ...eventLoopLagBuckets },
    },
    resources: {
      total: resources.length,
      byType,
    },
  };
}

function toMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function recordEventLoopLagSample(maxMs: number): void {
  const bucketStartMs = Math.floor(maxMs / EVENT_LOOP_LAG_BUCKET_MS) * EVENT_LOOP_LAG_BUCKET_MS;
  const bucketKey = `lag_${bucketStartMs}`;

  eventLoopLagBuckets[bucketKey] = (eventLoopLagBuckets[bucketKey] ?? 0) + 1;
  if (maxMs >= EVENT_LOOP_LAG_ALERT_MS) {
    eventLoopLagOver500Count += 1;
  }
}
