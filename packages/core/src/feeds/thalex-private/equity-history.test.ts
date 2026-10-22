import { describe, expect, it } from 'vitest';

import { thalexCashReplayEquity } from './codec.js';
import { ThalexAccountSummarySchema, ThalexTransactionHistoryResultSchema } from './types.js';

const DAY_MS = 86_400_000;
const MIDNIGHT = Date.UTC(2026, 9, 12);
const SETTLE = MIDNIGHT + 8 * 3_600_000;
const NOW = MIDNIGHT + 10 * 3_600_000;
const sec = (ms: number) => ms / 1000;

describe('thalexCashReplayEquity', () => {
  it('samples cash right after each 08:00 UTC settlement and ends with cash plus unsettled P&L', () => {
    const summary = ThalexAccountSummarySchema.parse({
      cash: [{ currency: 'USDT', balance: 1_300, collateral_factor: 1, transactable: true }],
      unrealised_pnl: 25,
      session_realised_pnl: 40,
    });
    const { transactions } = ThalexTransactionHistoryResultSchema.parse({
      transactions: [
        { time: sec(SETTLE + 4_000), asset: 'USDT', amount: 100, transaction_type: 'session settlement' },
        { time: sec(SETTLE - DAY_MS + 4_000), asset: 'USDT', amount: 200, transaction_type: 'session settlement' },
        { time: sec(MIDNIGHT - 2 * DAY_MS + 3_600_000), asset: 'USDT', amount: 1_000, transaction_type: 'deposit' },
      ],
      bookmark: null,
    });

    const points = thalexCashReplayEquity(summary, transactions, SETTLE - 3 * DAY_MS, NOW);

    expect(points).toEqual([
      { ts: SETTLE - 3 * DAY_MS, equityUsd: 0 },
      { ts: SETTLE - 2 * DAY_MS, equityUsd: 1_000 },
      { ts: SETTLE - DAY_MS, equityUsd: 1_200 },
      { ts: SETTLE, equityUsd: 1_300 },
      { ts: NOW, equityUsd: 1_365 },
    ]);
  });

  it('keeps a deposit made just after 08:00 out of that morning\'s point', () => {
    const summary = ThalexAccountSummarySchema.parse({
      cash: [{ currency: 'USDT', balance: 1_500 }],
      unrealised_pnl: 0,
    });
    const points = thalexCashReplayEquity(
      summary,
      [{ time: sec(SETTLE + 60_000), asset: 'USDT', amount: 500, transaction_type: 'deposit' }],
      SETTLE,
      NOW,
    );
    expect(points).toEqual([
      { ts: SETTLE, equityUsd: 1_000 },
      { ts: NOW, equityUsd: 1_500 },
    ]);
  });

  it('values non-stable collateral at the current index and skips unpriced assets', () => {
    const summary = ThalexAccountSummarySchema.parse({
      cash: [
        { currency: 'BTC', balance: 0.5, collateral_index_price: 60_000 },
        { currency: 'XYZ', balance: 10, collateral_index_price: null },
      ],
      unrealised_pnl: 0,
    });
    const points = thalexCashReplayEquity(
      summary,
      [{ time: sec(SETTLE + 3_600_000), asset: 'BTC', amount: 0.1 }],
      SETTLE,
      NOW,
    );
    expect(points[0]).toEqual({ ts: SETTLE, equityUsd: 0.4 * 60_000 });
    expect(points[1]).toEqual({ ts: NOW, equityUsd: 0.5 * 60_000 });
  });
});
