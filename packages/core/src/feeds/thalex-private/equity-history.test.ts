import { describe, expect, it } from 'vitest';

import { thalexCashReplayEquity } from './codec.js';
import { ThalexAccountSummarySchema, ThalexTransactionHistoryResultSchema } from './types.js';

const DAY_MS = 86_400_000;
const MIDNIGHT = Date.UTC(2026, 9, 12);
const NOW = MIDNIGHT + 10 * 3_600_000;
const sec = (ms: number) => ms / 1000;

describe('thalexCashReplayEquity', () => {
  it('walks balances back through the transaction log at each UTC midnight', () => {
    const summary = ThalexAccountSummarySchema.parse({
      cash: [{ currency: 'USDT', balance: 1_300, collateral_factor: 1, transactable: true }],
      unrealised_pnl: 25,
    });
    const { transactions } = ThalexTransactionHistoryResultSchema.parse({
      transactions: [
        { time: sec(MIDNIGHT + 8 * 3_600_000), asset: 'USDT', amount: 100, transaction_type: 'session settlement' },
        { time: sec(MIDNIGHT - DAY_MS + 8 * 3_600_000), asset: 'USDT', amount: 200, transaction_type: 'session settlement' },
        { time: sec(MIDNIGHT - 2 * DAY_MS + 3_600_000), asset: 'USDT', amount: 1_000, transaction_type: 'deposit' },
      ],
      bookmark: null,
    });

    const points = thalexCashReplayEquity(summary, transactions, MIDNIGHT - 3 * DAY_MS, NOW);

    expect(points).toEqual([
      { ts: MIDNIGHT - 3 * DAY_MS, equityUsd: 0 },
      { ts: MIDNIGHT - 2 * DAY_MS, equityUsd: 0 },
      { ts: MIDNIGHT - DAY_MS, equityUsd: 1_000 },
      { ts: MIDNIGHT, equityUsd: 1_200 },
      { ts: NOW, equityUsd: 1_325 },
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
      [{ time: sec(MIDNIGHT + 3_600_000), asset: 'BTC', amount: 0.1 }],
      MIDNIGHT,
      NOW,
    );
    expect(points[0]).toEqual({ ts: MIDNIGHT, equityUsd: 0.4 * 60_000 });
    expect(points[1]).toEqual({ ts: NOW, equityUsd: 0.5 * 60_000 });
  });
});
