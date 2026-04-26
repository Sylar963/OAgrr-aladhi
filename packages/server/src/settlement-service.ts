import type { FastifyBaseLogger } from 'fastify';
import { paperTradingStore } from './trading-services.js';
import { spotService } from './services.js';
import { settleExpiredPositionsForAccount } from './routes/paper/workspace.js';

const SETTLEMENT_HOUR_UTC = 8;
const SETTLEMENT_MINUTE_UTC = 5;

let settlementTimer: ReturnType<typeof setTimeout> | null = null;

export function startSettlementJob(log: FastifyBaseLogger): void {
  if (!paperTradingStore.enabled) return;
  void runSettlementSafely(log, 'boot');
  scheduleNext(log);
}

export function disposeSettlementJob(): void {
  if (settlementTimer) {
    clearTimeout(settlementTimer);
    settlementTimer = null;
  }
}

export async function runSettlementOnce(
  log: FastifyBaseLogger,
  asOf: Date = new Date(),
): Promise<void> {
  if (!paperTradingStore.enabled) return;
  const start = Date.now();
  const accountIds = await paperTradingStore.listAllAccountIdsWithOpenPositions();
  let totalFills = 0;
  let totalAccounts = 0;
  for (const accountId of accountIds) {
    const result = await settleExpiredPositionsForAccount(accountId, asOf, {
      resolveSpot: (underlying, expiry) => resolveSettlementSpot(underlying, expiry, asOf, log),
      log,
    });
    if (result.fillsCount > 0) {
      totalFills += result.fillsCount;
      totalAccounts += 1;
      log.info(
        {
          accountId,
          fills: result.fillsCount,
          trades: result.settledTradeIds.length,
          skipped: result.skipped.length,
        },
        'settlement applied',
      );
    }
    for (const skip of result.skipped) {
      log.warn(skip, 'settlement skipped');
    }
  }
  log.info(
    { ms: Date.now() - start, accounts: totalAccounts, fills: totalFills },
    'settlement run complete',
  );
}

async function resolveSettlementSpot(
  underlying: string,
  expiry: string,
  asOf: Date,
  log: FastifyBaseLogger,
): Promise<number | null> {
  const cached = await paperTradingStore.getSettlementPrice(underlying, expiry);
  if (cached) return cached.priceUsd;

  const snap = spotService.getSnapshot(underlying);
  if (!snap || !Number.isFinite(snap.lastPrice) || snap.lastPrice <= 0) {
    log.warn({ underlying, expiry }, 'spot snapshot unavailable for settlement');
    return null;
  }
  await paperTradingStore.upsertSettlementPrice({
    underlying,
    expiry,
    priceUsd: snap.lastPrice,
    source: 'spot-runtime',
    capturedAt: asOf,
  });
  return snap.lastPrice;
}

function scheduleNext(log: FastifyBaseLogger): void {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(SETTLEMENT_HOUR_UTC, SETTLEMENT_MINUTE_UTC, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delayMs = next.getTime() - now.getTime();
  settlementTimer = setTimeout(() => {
    void runSettlementSafely(log, 'cron').finally(() => scheduleNext(log));
  }, delayMs);
  settlementTimer.unref?.();
  log.info({ nextRunUtc: next.toISOString() }, 'settlement job scheduled');
}

async function runSettlementSafely(log: FastifyBaseLogger, trigger: string): Promise<void> {
  try {
    await runSettlementOnce(log);
  } catch (err: unknown) {
    log.warn({ err: String(err), trigger }, 'settlement run failed');
  }
}
