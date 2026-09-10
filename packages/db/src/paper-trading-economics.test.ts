import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresPaperTradingStore } from './paper-trading-store.js';

describe('PostgresPaperTradingStore fill economics', () => {
  it('writes canonical and native fill context in the additive columns', async () => {
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [], rowCount: 1 }));
    const store = new PostgresPaperTradingStore({ query } as unknown as Pool);
    const filledAt = new Date('2026-06-01T00:00:00Z');

    await store.insertFills([
      {
        id: 'fil_1',
        orderId: 'ord_1',
        legIndex: 0,
        venue: 'okx',
        side: 'buy',
        optionRight: 'call',
        underlying: 'BTC',
        expiry: '2026-06-26',
        strike: 70_000,
        quantity: 0.05,
        requestedQuantity: 0.05,
        quantityUnit: 'base',
        contractMultiplierBase: 0.01,
        nativeQuantity: 5,
        requestedNativeQuantity: 5,
        nativeMinQuantity: 1,
        nativeQuantityStep: 1,
        nativePriceTick: 0.0001,
        priceUsd: 4_200,
        feesUsd: 1.05,
        slippageUsd: 0,
        partialFill: false,
        benchmarkBidUsd: 4_000,
        benchmarkAskUsd: 4_200,
        benchmarkMidUsd: 4_100,
        underlyingSpotUsd: 70_000,
        source: 'paper',
        filledAt,
      },
    ]);

    expect(query.mock.calls[0]?.[0]).toContain(
      'quantity_unit, contract_multiplier_base, native_quantity, requested_native_quantity',
    );
    expect(query.mock.calls[0]?.[1]?.slice(9, 18)).toEqual([
      0.05,
      0.05,
      'base',
      0.01,
      5,
      5,
      1,
      1,
      0.0001,
    ]);
  });

  it('round-trips canonical and native fill quantities', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'fil_1',
          order_id: 'ord_1',
          leg_index: 0,
          venue: 'okx',
          side: 'buy',
          option_right: 'call',
          underlying: 'BTC',
          expiry: '2026-06-26',
          strike: '70000',
          quantity: '0.05',
          requested_quantity: '0.05',
          quantity_unit: 'base',
          contract_multiplier_base: '0.01',
          native_quantity: '5',
          requested_native_quantity: '5',
          native_min_quantity: '1',
          native_quantity_step: '1',
          native_price_tick: '0.0001',
          price_usd: '4200',
          fees_usd: '1.05',
          slippage_usd: '0',
          partial_fill: false,
          benchmark_bid_usd: '4000',
          benchmark_ask_usd: '4200',
          benchmark_mid_usd: '4100',
          underlying_spot_usd: '70000',
          source: 'paper',
          filled_at: new Date('2026-06-01T00:00:00Z'),
        },
      ],
      rowCount: 1,
    }));
    const store = new PostgresPaperTradingStore({ query } as unknown as Pool);

    const rows = await store.listFills('acct_1', 10);

    expect(rows[0]).toMatchObject({
      quantity: 0.05,
      quantityUnit: 'base',
      contractMultiplierBase: 0.01,
      nativeQuantity: 5,
      requestedNativeQuantity: 5,
      nativeMinQuantity: 1,
      nativeQuantityStep: 1,
      nativePriceTick: 0.0001,
    });
  });

  it('hydrates legacy fill rows as base quantity with null native context', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'fil_legacy',
          order_id: 'ord_legacy',
          leg_index: 0,
          venue: 'deribit',
          side: 'buy',
          option_right: 'call',
          underlying: 'BTC',
          expiry: '2026-06-26',
          strike: '70000',
          quantity: '0.1',
          requested_quantity: null,
          price_usd: '4200',
          fees_usd: '1',
          source: 'paper',
          filled_at: new Date('2026-06-01T00:00:00Z'),
        },
      ],
      rowCount: 1,
    }));
    const store = new PostgresPaperTradingStore({ query } as unknown as Pool);

    const rows = await store.listFills('acct_1', 10);

    expect(rows[0]).toMatchObject({
      quantity: 0.1,
      requestedQuantity: 0.1,
      quantityUnit: 'base',
      contractMultiplierBase: null,
      nativeQuantity: null,
      requestedNativeQuantity: null,
      nativeMinQuantity: null,
      nativeQuantityStep: null,
      nativePriceTick: null,
    });
  });

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
