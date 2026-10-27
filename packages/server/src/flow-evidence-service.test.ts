import { describe, expect, it, vi } from 'vitest';
import { NoopOiSnapshotStore, NoopTradeStore, type PersistedOiSnapshot } from '@oggregator/db';
import { FlowEvidenceService, flowOiSymbol, oiContext } from './flow-evidence-service.js';
import type { TradeEvent } from '@oggregator/core';

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
