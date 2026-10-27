import { describe, expect, it, vi } from 'vitest';
import { NoopOiSnapshotStore, NoopTradeStore, type PersistedOiSnapshot } from '@oggregator/db';
import { FlowEvidenceService, flowOiSymbol, oiContext } from './flow-evidence-service.js';
import { buildBlockTradeUid, type BlockTradeEvent, type TradeEvent } from '@oggregator/core';
import { SqliteTradeStore, type PersistedTradeRecord } from '@oggregator/db';

const instrument = 'BTC-30OCT26-80000-C';
const symbol = 'BTC/USD:BTC-261030-80000-C';
const time = Date.parse('2026-10-26T12:05:00Z');
function snapshot(timestamp: string, oi: number): PersistedOiSnapshot {
  return {
    venue: 'deribit',
    underlying: 'BTC',
    instrumentName: symbol,
    expiry: '2026-10-30',
    strike: 80000,
    optionType: 'call',
    openInterest: oi,
    snapshotTs: new Date(timestamp),
  };
}

describe('FLOW OI context', () => {
  it('reconciles institutional legs separately without adding the RFQ to tape volume twice', async () => {
    const put = instrument.replace(/C$/, 'P');
    const block: BlockTradeEvent = {
      venue: 'deribit',
      underlying: 'BTC',
      source: 'rfq',
      tradeId: 'RFQ-42',
      timestamp: time,
      direction: 'buy',
      totalSize: 20,
      notionalUsd: 1600000,
      indexPrice: 80000,
      strategy: 'STRADDLE',
      exchangeEvidence: { rfqId: '42', expectedLegCount: 2, groupComplete: true },
      legs: [instrument, put].map((name) => ({
        instrument: name,
        direction: 'buy',
        size: 10,
        price: 0.01,
        ratio: 1,
      })),
    };
    const trades = [instrument, put].map(
      (name): TradeEvent => ({
        venue: 'deribit',
        underlying: 'BTC',
        instrument: name,
        tradeId: name,
        timestamp: time + 4,
        side: 'buy',
        size: 10,
        price: 0.01,
        indexPrice: 80000,
        iv: null,
        markPrice: null,
        isBlock: true,
        exchangeEvidence: { rfqId: '42', blockTradeId: 'block-42', expectedLegCount: 2 },
      }),
    );
    const store = new SqliteTradeStore(':memory:');
    const service = new FlowEvidenceService({
      trades: store,
      live: () => trades,
      blocks: () => [block],
      oi: {
        enabled: true,
        loadWindow: async () => ({
          complete: true,
          rows: [
            snapshot('2026-10-26T12:00:00Z', 100),
            snapshot('2026-10-26T12:15:00Z', 110),
            { ...snapshot('2026-10-26T12:00:00Z', 100), instrumentName: symbol.replace(/C$/, 'P') },
            { ...snapshot('2026-10-26T12:15:00Z', 90), instrumentName: symbol.replace(/C$/, 'P') },
          ],
        }),
      },
    });
    try {
      const result = await service.get({
        mode: 'institutional',
        tradeUid: buildBlockTradeUid(block),
        venue: 'deribit',
        underlying: 'BTC',
        instrument,
        timestamp: time,
      });
      expect(result?.analysis.positionEffect).toBe('mixed');
      expect(result?.evidence?.blockTradeId).toBe('block-42');
      expect(result?.analysis.legs.map((leg) => leg.position?.action)).toEqual([
        'buy_to_open',
        'buy_to_close',
      ]);
      expect(result?.analysis.legs.map((leg) => leg.position?.intervalVolume)).toEqual([10, 10]);
      trades.push(
        ...trades.map((print) => ({
          ...print,
          tradeId: `${print.tradeId}-second`,
          timestamp: print.timestamp + 10,
          exchangeEvidence: { ...print.exchangeEvidence, blockTradeId: 'block-43' },
        })),
      );
      const ambiguous = new FlowEvidenceService({
        trades: store,
        live: () => trades,
        blocks: () => [block],
        oi: new NoopOiSnapshotStore(),
      });
      const unmatched = await ambiguous.get({
        mode: 'institutional',
        tradeUid: buildBlockTradeUid(block),
        venue: 'deribit',
        underlying: 'BTC',
        instrument,
        timestamp: time,
      });
      expect(unmatched?.evidence?.blockTradeId).toBeUndefined();
    } finally {
      await store.dispose();
    }
  });
  it('reconciles a persisted print with all interval volume and deduplicates its live copy', async () => {
    const store = new SqliteTradeStore(':memory:');
    const row: PersistedTradeRecord = {
      tradeUid: `deribit:${instrument}:1`,
      mode: 'live',
      venue: 'deribit',
      underlying: 'BTC',
      instrumentName: instrument,
      tradeTs: new Date(time),
      ingestedAt: new Date(time),
      direction: 'sell',
      contracts: 0.2,
      price: 0.01,
      premiumUsd: 160,
      notionalUsd: 16000,
      referencePriceUsd: 80000,
      expiry: '2026-10-30',
      strike: 80000,
      optionType: 'call',
      iv: null,
      markPrice: null,
      isBlock: false,
      strategyLabel: null,
      legs: null,
      raw: { tradeId: '1', size: 0.2, exchangeEvidence: { tradeSequence: '1367' } },
    };
    store.writeMany([row]);
    const trade: TradeEvent = {
      venue: 'deribit',
      underlying: 'BTC',
      instrument,
      tradeId: '1',
      timestamp: time,
      side: 'sell',
      size: 0.2,
      price: 0.01,
      iv: null,
      indexPrice: null,
      markPrice: null,
      isBlock: false,
      exchangeEvidence: { tradeSequence: '1367' },
    };
    const service = new FlowEvidenceService({
      trades: store,
      live: () => [trade],
      blocks: () => [],
      oi: {
        enabled: true,
        loadWindow: async () => ({
          complete: true,
          rows: [snapshot('2026-10-26T12:00:00Z', 1196.8), snapshot('2026-10-26T12:15:00Z', 1197)],
        }),
      },
    });
    try {
      const result = await service.get({
        mode: 'live',
        tradeUid: row.tradeUid,
        venue: 'deribit',
        underlying: 'BTC',
        instrument,
        timestamp: time,
      });
      expect(result?.analysis.positionEffect).toBe('inferred_open');
      expect(result?.analysis.legs[0]?.position).toMatchObject({
        action: 'sell_to_open',
        intervalVolume: 0.2,
        otherVolume: 0,
        tradeCount: 1,
        coverage: 'recorded',
      });
    } finally {
      await store.dispose();
    }
  });
  it('prefers a tighter exchange-timestamped bracket and blocks known sequence gaps', async () => {
    const trades = [1, 3].map(
      (id): TradeEvent => ({
        venue: 'deribit',
        underlying: 'BTC',
        instrument,
        tradeId: String(id),
        timestamp: time + id,
        side: 'buy',
        size: 1,
        price: 0.01,
        iv: null,
        indexPrice: null,
        markPrice: null,
        isBlock: false,
        exchangeEvidence: { tradeSequence: String(id) },
      }),
    );
    const store = new SqliteTradeStore(':memory:');
    const service = new FlowEvidenceService({
      trades: store,
      live: () => trades,
      blocks: () => [],
      oi: {
        enabled: true,
        loadWindow: async () => ({
          complete: true,
          rows: [snapshot('2026-10-26T12:00:00Z', 100), snapshot('2026-10-26T12:15:00Z', 120)],
        }),
      },
      fastOi: {
        bracket: () => ({
          before: {
            venue: 'deribit',
            instrument,
            underlying: 'BTC',
            timestamp: time - 1000,
            observedAt: time - 999,
            openInterest: 100,
          },
          after: {
            venue: 'deribit',
            instrument,
            underlying: 'BTC',
            timestamp: time + 1000,
            observedAt: time + 1001,
            openInterest: 102,
          },
        }),
      },
    });
    try {
      const result = await service.get({
        mode: 'live',
        tradeUid: `deribit:${instrument}:1`,
        venue: 'deribit',
        underlying: 'BTC',
        instrument,
        timestamp: time + 1,
      });
      expect(result?.oi[0]).toMatchObject({ timing: 'exchange', delta: 2, intervalMs: 2000 });
      expect(result?.analysis.legs[0]?.position).toMatchObject({
        action: null,
        status: 'incomplete',
        coverage: 'gap',
      });
    } finally {
      await store.dispose();
    }
  });
  it('uses the samples surrounding execution and exposes the observed interval', () => {
    const result = oiContext(instrument, symbol, time, {
      complete: true,
      rows: [
        snapshot('2026-10-26T12:30:00Z', 500),
        snapshot('2026-10-26T12:00:00Z', 100),
        snapshot('2026-10-26T12:15:00Z', 120),
      ],
    });
    expect(result).toMatchObject({
      status: 'bracketed',
      delta: 20,
      intervalMs: 900000,
      timing: 'sampled',
      tradeCoverage: 'unverified',
    });
  });
  it('marks sampling gaps and does not substitute later data for a missing before sample', () => {
    const rows = [snapshot('2026-10-26T12:00:00Z', 100), snapshot('2026-10-26T12:45:00Z', 120)];
    expect(oiContext(instrument, symbol, time, { complete: true, rows }).status).toBe('gap');
    expect(
      oiContext(instrument, symbol, time, { complete: true, rows: rows.slice(1) }),
    ).toMatchObject({ status: 'unavailable', delta: null });
    expect(oiContext(instrument, symbol, time, { complete: false, rows }).delta).toBeNull();
  });
  it('keeps settlement families distinct', () => {
    expect(flowOiSymbol('deribit', 'BTC', 'ETH-30OCT26-80000-C')).toBeNull();
    expect(flowOiSymbol('deribit', 'BTC', instrument)).toBe(symbol);
    expect(flowOiSymbol('deribit', 'BTC', 'BTC_USDC-30OCT26-80000-C')).toBe(
      'BTC/USD:USDC-261030-80000-C',
    );
    expect(flowOiSymbol('bybit', 'BTC', `${instrument}-USDC`)).toBe('BTC/USD:USDC-261030-80000-C');
    expect(flowOiSymbol('derive', 'HYPE', 'HYPE-20261113-92_5-C')).toBe(
      'HYPE/USD:USDC-261113-92.5-C',
    );
  });
  it('returns unknown position effect even with increasing OI and caches context reads', async () => {
    const trade: TradeEvent = {
      venue: 'deribit',
      tradeId: '1',
      instrument,
      underlying: 'BTC',
      side: 'buy',
      price: 0.01,
      size: 20,
      iv: null,
      markPrice: null,
      indexPrice: null,
      isBlock: false,
      timestamp: time,
    };
    const loadWindow = vi.fn(async () => ({
      complete: true,
      rows: [snapshot('2026-10-26T12:00:00Z', 100), snapshot('2026-10-26T12:15:00Z', 120)],
    }));
    const oi = new NoopOiSnapshotStore();
    const service = new FlowEvidenceService({
      trades: new NoopTradeStore(),
      oi: {
        enabled: true,
        loadWindow,
        writeMany: (rows) => oi.writeMany(rows),
        prune: (date) => oi.prune(date),
        dispose: () => oi.dispose(),
      },
      live: () => [trade],
      blocks: () => [],
    });
    const query = {
      mode: 'live' as const,
      tradeUid: `deribit:${instrument}:1`,
      venue: 'deribit',
      underlying: 'BTC',
      instrument,
      timestamp: time,
    };
    const result = await service.get(query);
    expect(result?.analysis.positionEffect).toBe('unknown');
    expect(result?.oi[0]?.delta).toBe(20);
    await service.get(query);
    expect(loadWindow).toHaveBeenCalledTimes(1);
    expect(await service.get({ ...query, tradeUid: 'missing' })).toBeNull();
  });
});
