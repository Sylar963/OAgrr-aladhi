import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteTradeStore, type PersistedTradeRecord } from '@oggregator/db';
import { storedFlowTrade, storedFlowTrades, storedBlockTrade } from './flow-records.js';

function record(overrides: Partial<PersistedTradeRecord> = {}): PersistedTradeRecord {
  return {
    tradeUid: 'deribit:BTC-30OCT26-80000-C:1',
    mode: 'live',
    venue: 'deribit',
    underlying: 'BTC',
    instrumentName: 'BTC-30OCT26-80000-C',
    tradeTs: new Date(1_000),
    ingestedAt: new Date(1_001),
    direction: 'buy',
    contracts: 50,
    price: 0.01,
    premiumUsd: 40_000,
    notionalUsd: 4_000_000,
    referencePriceUsd: 80_000,
    expiry: '2026-10-30',
    strike: 80_000,
    optionType: 'call',
    iv: null,
    markPrice: null,
    isBlock: true,
    strategyLabel: null,
    legs: null,
    raw: {
      tradeId: '1',
      size: 50,
      indexPrice: 80_000,
      exchangeEvidence: {
        blockTradeId: 'B1',
        expectedLegCount: 2,
        tradeSequence: '42',
        liquidation: 'taker',
      },
    },
    ...overrides,
  };
}

describe('persisted FLOW evidence', () => {
  it('round-trips evidence through SQLite and reconstructs a linked straddle from stored prints', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-evidence-'));
    const store = new SqliteTradeStore(join(dir, 'tape.sqlite'));
    try {
      const first = record();
      const second = record({
        tradeUid: 'deribit:BTC-30OCT26-80000-P:2',
        instrumentName: 'BTC-30OCT26-80000-P',
        optionType: 'put',
        raw: { ...first.raw, tradeId: '2' },
      });
      store.writeMany([first, second]);
      const trades = storedFlowTrades(await store.loadHistory({ mode: 'live', limit: 10 }));
      expect(trades).toHaveLength(2);
      expect(trades[0]?.exchangeEvidence).toMatchObject({
        blockTradeId: 'B1',
        tradeSequence: '42',
        liquidation: 'taker',
      });
      expect(
        trades.every(
          (trade) =>
            trade.analysis?.structure === 'STRADDLE' && trade.analysis.positionEffect === 'unknown',
        ),
      ).toBe(true);
    } finally {
      await store.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('keeps legacy records usable without inventing grouping evidence or multiplying normalized size twice', () => {
    const trade = storedFlowTrade(record({ venue: 'okx', contracts: 0.5, raw: {} }));
    expect(trade?.size).toBe(50);
    expect(trade?.analysis?.legs[0]?.quantity).toBe(0.5);
    expect(trade?.analysis).toMatchObject({
      linkage: 'unlinked',
      completeness: 'unknown',
      positionEffect: 'unknown',
    });
    expect(trade?.exchangeEvidence).toBeUndefined();
  });
  it('derives structure from legs instead of trusting an incorrect vendor strategy label', () => {
    const block = storedBlockTrade(
      record({
        mode: 'institutional',
        strategyLabel: 'STRADDLE',
        raw: { tradeId: 'B1' },
        legs: [
          { instrument: 'BTC-30OCT26-80000-C', direction: 'buy', price: 1000, size: 10, ratio: 1 },
          { instrument: 'BTC-30OCT26-90000-C', direction: 'sell', price: 500, size: 10, ratio: 1 },
        ],
      }),
    );
    expect(block?.analysis).toMatchObject({
      structure: 'CALL_SPREAD',
      executionSide: 'mixed',
      completeness: 'unknown',
    });
  });
});
