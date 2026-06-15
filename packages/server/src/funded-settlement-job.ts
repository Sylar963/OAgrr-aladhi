import type { FastifyBaseLogger } from 'fastify';
import { fundedEngine, isFundedEnabled } from './funded-services.js';

const SETTLEMENT_HOUR_UTC = 8;

let timer: ReturnType<typeof setTimeout> | null = null;

export function computeNextSettlementBoundary(now: Date): Date {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      SETTLEMENT_HOUR_UTC,
      0,
      0,
      0,
    ),
  );
  if (now.getTime() >= next.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

async function runSafely(log: FastifyBaseLogger, boundary: Date): Promise<void> {
  try {
    const count = await fundedEngine.settleAllActive(boundary);
    log.info({ boundary: boundary.toISOString(), runs: count }, 'funded settlement run complete');
  } catch (err) {
    log.warn({ err: String(err) }, 'funded settlement run failed');
  }
}

function scheduleNext(log: FastifyBaseLogger): void {
  const now = new Date();
  const boundary = computeNextSettlementBoundary(now);
  const delay = Math.max(0, boundary.getTime() - now.getTime());
  timer = setTimeout(() => {
    void runSafely(log, boundary).finally(() => scheduleNext(log));
  }, delay);
  timer.unref?.();
}

export function startFundedSettlementJob(log: FastifyBaseLogger): void {
  if (!isFundedEnabled()) return;
  scheduleNext(log);
}

export function disposeFundedSettlementJob(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
