import type { VenueId } from '@oggregator/core';
import type { PersistedTradeRecord, TradeHistoryQuery, TradeHistoryReader } from '@oggregator/db';
import { describe, expect, it } from 'vitest';

import {
  DealerFlowTape,
  type IntervalFlow,
  indexIntervalFlow,
  type TapeTrade,
} from './dealer-flow-tape.js';

let uidSeq = 0;
function trade(
  instrument: string,
  side: 'buy' | 'sell',
  size: number,
  timestamp: number,
  venue: VenueId = 'deribit',
): TapeTrade {
  return { uid: `u${++uidSeq}`, venue, instrument, side, size, timestamp };
}

describe('indexIntervalFlow', () => {
  it('nets taker flow for the contract inside (fromTs, toTs]', () => {
    const lookup = indexIntervalFlow(
      [
        trade('P', 'buy', 5, 50),
        trade('C', 'buy', 3, 150),
        trade('C', 'sell', 1, 180),
        trade('C', 'buy', 9, 100),
        trade('C', 'buy', 9, 201),
        trade('C', 'buy', 4, 150, 'okx'),
      ],
      0,
    );
    expect(lookup('deribit', 'C', 100, 200)).toEqual({ netFlow: 2, hasFlow: true });
    expect(lookup('okx', 'C', 100, 200)).toEqual({ netFlow: 4, hasFlow: true });
    expect(lookup('deribit', 'Z', 100, 200).hasFlow).toBe(false);
  });

  it('reports no flow when the interval opened before the tape was covering', () => {
    const lookup = indexIntervalFlow([trade('C', 'buy', 3, 150)], 120);
    expect(lookup('deribit', 'C', 100, 200).hasFlow).toBe(false);
    expect(lookup('deribit', 'C', 120, 200).hasFlow).toBe(true);
  });

  it('matches a full tape scan for every contract and window', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const venues: VenueId[] = ['deribit', 'okx', 'bybit'];
    const symbols = ['A', 'B', 'C', 'D'];
    const trades = Array.from({ length: 2_000 }, () =>
      trade(
        symbols[Math.floor(rand() * symbols.length)]!,
        rand() < 0.5 ? 'buy' : 'sell',
        Math.round(rand() * 100) / 10,
        1_000 + Math.floor(rand() * 10_000),
        venues[Math.floor(rand() * venues.length)]!,
      ),
    );
    const coveredFrom = 2_000;
    const naive = (venue: VenueId, symbol: string, fromTs: number, toTs: number): IntervalFlow => {
      if (coveredFrom > fromTs) return { netFlow: 0, hasFlow: false };
      let net = 0;
      let matched = false;
      for (const t of trades) {
        if (t.venue !== venue || t.instrument !== symbol) continue;
        if (t.timestamp <= fromTs || t.timestamp > toTs) continue;
        net += t.side === 'buy' ? t.size : -t.size;
        matched = true;
      }
      return matched ? { netFlow: net, hasFlow: true } : { netFlow: 0, hasFlow: false };
    };
    const lookup = indexIntervalFlow(trades, coveredFrom);
    for (const venue of [...venues, 'binance' as VenueId]) {
      for (const symbol of [...symbols, 'Z']) {
        for (const [fromTs, toTs] of [
          [500, 20_000],
          [3_000, 6_000],
          [2_000, 2_001],
          [9_000, 12_000],
        ] as const) {
          const got = lookup(venue, symbol, fromTs, toTs);
          const want = naive(venue, symbol, fromTs, toTs);
          expect(got.hasFlow).toBe(want.hasFlow);
          expect(got.netFlow).toBeCloseTo(want.netFlow, 9);
        }
      }
    }
  });
});

describe('DealerFlowTape', () => {
  it('covers nothing until recording starts', () => {
    const tape = new DealerFlowTape(['BTC'], 10_000, () => 5_000);
    tape.record('BTC', trade('C', 'buy', 1, 4_000));
    expect(tape.lookup('BTC')('deribit', 'C', 3_000, 5_000).hasFlow).toBe(false);
    tape.markRecording('BTC', 3_000);
    expect(tape.lookup('BTC')('deribit', 'C', 3_000, 5_000)).toEqual({ netFlow: 1, hasFlow: true });
  });

  it('drops replayed prints by uid and ignores other underlyings', () => {
    const tape = new DealerFlowTape(['BTC'], 10_000, () => 5_000);
    tape.markRecording('BTC', 0);
    const t = trade('C', 'buy', 2, 4_000);
    tape.record('BTC', t);
    tape.record('btc', { ...t });
    tape.record('ETH', trade('C', 'buy', 7, 4_000));
    expect(tape.lookup('BTC')('deribit', 'C', 0, 5_000).netFlow).toBe(2);
  });

  it('keeps far more than 2000 prints so a burst cannot evict the interval', () => {
    const tape = new DealerFlowTape(['BTC'], 3_600_000, () => 1_000_000);
    tape.markRecording('BTC', 0);
    tape.record('BTC', trade('C', 'sell', 4, 100_100));
    for (let i = 0; i < 10_000; i++) tape.record('BTC', trade('X', 'buy', 0.01, 200_000 + i));
    expect(tape.lookup('BTC')('deribit', 'C', 100_000, 1_000_000)).toEqual({
      netFlow: -4,
      hasFlow: true,
    });
  });

  it('prunes past the retention window and pulls coverage forward with it', () => {
    let now = 10_000;
    const tape = new DealerFlowTape(['BTC'], 5_000, () => now);
    tape.markRecording('BTC', 0);
    tape.record('BTC', trade('C', 'buy', 1, 6_000));
    now = 12_000;
    expect(tape.lookup('BTC')('deribit', 'C', 5_000, 12_000).hasFlow).toBe(false);
    expect(tape.coveredFrom('BTC')).toBe(7_000);
  });

  describe('backfill', () => {
    function record(ts: number, side: 'buy' | 'sell', contracts: number): PersistedTradeRecord {
      return {
        tradeUid: `deribit:C:${ts}`,
        mode: 'live',
        venue: 'deribit',
        underlying: 'BTC',
        instrumentName: 'C',
        tradeTs: new Date(ts),
        ingestedAt: new Date(ts),
        direction: side,
        contracts,
        price: null,
        premiumUsd: null,
        notionalUsd: null,
        referencePriceUsd: null,
        expiry: null,
        strike: null,
        optionType: null,
        iv: null,
        markPrice: null,
        isBlock: false,
        strategyLabel: null,
        legs: null,
        raw: {},
      };
    }

    function spool(records: PersistedTradeRecord[]): TradeHistoryReader {
      return {
        enabled: true,
        async loadHistory(q: TradeHistoryQuery) {
          return records
            .filter((r) => r.underlying === q.underlying && r.mode === q.mode)
            .filter((r) => q.startTs == null || r.tradeTs >= q.startTs)
            .filter((r) => q.endTs == null || r.tradeTs < q.endTs)
            .filter((r) => {
              if (q.beforeTs == null) return true;
              if (r.tradeTs < q.beforeTs) return true;
              return (
                q.beforeUid != null &&
                r.tradeTs.getTime() === q.beforeTs.getTime() &&
                r.tradeUid < q.beforeUid
              );
            })
            .sort((a, b) => b.tradeTs.getTime() - a.tradeTs.getTime())
            .slice(0, q.limit);
        },
      } as unknown as TradeHistoryReader;
    }

    it('fills the restart gap and extends coverage back to the requested start', async () => {
      const tape = new DealerFlowTape(['BTC'], 100_000, () => 50_000);
      tape.markRecording('BTC', 40_000);
      const records = [record(5_000, 'sell', 1)];
      for (let ts = 20_001; ts < 40_000; ts += 3) records.push(record(ts, 'buy', 1));
      await tape.backfill('BTC', spool(records), 20_000);
      expect(tape.coveredFrom('BTC')).toBe(20_000);
      expect(tape.lookup('BTC')('deribit', 'C', 20_000, 50_000)).toEqual({
        netFlow: records.length - 1,
        hasFlow: true,
      });
    });

    it('leaves coverage alone when the spool was flushed past the gap start', async () => {
      const tape = new DealerFlowTape(['BTC'], 100_000, () => 50_000);
      tape.markRecording('BTC', 40_000);
      await tape.backfill('BTC', spool([record(30_000, 'buy', 1)]), 20_000);
      expect(tape.coveredFrom('BTC')).toBe(40_000);
      expect(tape.lookup('BTC')('deribit', 'C', 20_000, 50_000).hasFlow).toBe(false);
    });
  });
});
