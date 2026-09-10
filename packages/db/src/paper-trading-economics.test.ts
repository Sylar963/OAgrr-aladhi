import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresPaperTradingStore } from './paper-trading-store.js';

describe('PostgresPaperTradingStore fill economics', () => {
  it('loads exact account-scoped fill economics grouped by instrument', async () => {
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({
      rows: [
        {
          underlying: 'BTC',
          expiry: '2026-06-26',
          strike: '70000',
          option_right: 'call',
          premium_cash_flow_usd: '20.5',
          fees_usd: '3.25',
        },
      ],
      rowCount: 1,
    }));
    const store = new PostgresPaperTradingStore({ query } as unknown as Pool);

    const rows = await store.listFillEconomics('acct_1');

    expect(query.mock.calls[0]?.[0]).toContain('JOIN paper_orders o ON o.id = f.order_id');
    expect(query.mock.calls[0]?.[0]).toContain('WHERE o.account_id = $1');
    expect(query.mock.calls[0]?.[0]).not.toContain('LIMIT');
    expect(query.mock.calls[0]?.[1]).toEqual(['acct_1']);
    expect(rows).toEqual([
      {
        underlying: 'BTC',
        expiry: '2026-06-26',
        strike: 70_000,
        optionRight: 'call',
        premiumCashFlowUsd: 20.5,
        feesUsd: 3.25,
      },
    ]);
  });

  it('loads every fill linked to a trade without an account-wide limit', async () => {
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [], rowCount: 0 }));
    const store = new PostgresPaperTradingStore({ query } as unknown as Pool);

    await store.listTradeFills('trade_1');

    expect(query.mock.calls[0]?.[0]).toContain(
      'JOIN paper_trade_orders t ON t.order_id = f.order_id',
    );
    expect(query.mock.calls[0]?.[0]).toContain('WHERE t.trade_id = $1');
    expect(query.mock.calls[0]?.[0]).not.toContain('LIMIT');
    expect(query.mock.calls[0]?.[1]).toEqual(['trade_1']);
  });
});
