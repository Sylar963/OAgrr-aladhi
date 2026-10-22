import { describe, expect, it } from 'vitest';

import {
  formatThalexOptionInstrument,
  parseThalexOptionInstrument,
  thalexAccountEquity,
  thalexAccountMargin,
  thalexCashTransactions,
  thalexPortfolioEntryToLeg,
  thalexPortfolioToLegs,
  thalexRealizedPnl,
} from './codec.js';
import type { ExchangePortfolioTrade } from '@oggregator/protocol';
import type { ThalexPortfolioEntry } from './types.js';

const SAMPLE: ThalexPortfolioEntry = {
  instrument_name: 'BTC-21APR26-75000-C',
  position: 2.5,
  average_price: 1850.5,
  mark_price: 1900,
  delta: 0.6,
};

describe('formatThalexOptionInstrument', () => {
  it('round-trips with the instrument parser', () => {
    for (const name of ['BTC-27NOV26-110000-C', 'ETH-02JAN27-3250-P']) {
      const parsed = parseThalexOptionInstrument(name);
      expect(parsed).not.toBeNull();
      expect(formatThalexOptionInstrument(parsed!)).toBe(name);
    }
  });
});

describe('thalexPortfolioEntryToLeg', () => {
  it('parses a long call with DDMMMYY date', () => {
    const leg = thalexPortfolioEntryToLeg(SAMPLE, 1_715_000_000_000);
    expect(leg).not.toBeNull();
    expect(leg).toMatchObject({
      underlying: 'BTC',
      expiry: '2026-04-21',
      strike: 75000,
      optionRight: 'call',
      size: 2.5,
      entryPriceUsd: 1850.5,
      venueHint: 'thalex',
      source: 'thalex',
    });
  });

  it('carries the venue mark with its receipt time', () => {
    const leg = thalexPortfolioEntryToLeg(SAMPLE, 1_715_000_000_000);
    expect(leg?.venueMarkPriceUsd).toBe(1900);
    expect(leg?.venueMarkTs).toBe(1_715_000_000_000);
    const unmarked = thalexPortfolioEntryToLeg({ ...SAMPLE, mark_price: null });
    expect(unmarked?.venueMarkPriceUsd).toBeNull();
    expect(unmarked?.venueMarkTs).toBeNull();
  });

  it('parses a short put', () => {
    const leg = thalexPortfolioEntryToLeg({
      ...SAMPLE,
      instrument_name: 'ETH-28MAR26-3500-P',
      position: -1,
    });
    expect(leg?.underlying).toBe('ETH');
    expect(leg?.expiry).toBe('2026-03-28');
    expect(leg?.optionRight).toBe('put');
    expect(leg?.size).toBe(-1);
  });

  it('returns null for malformed instrument name', () => {
    expect(thalexPortfolioEntryToLeg({ ...SAMPLE, instrument_name: 'BAD' })).toBeNull();
  });

  it('returns null for zero position', () => {
    expect(thalexPortfolioEntryToLeg({ ...SAMPLE, position: 0 })).toBeNull();
  });

  it('returns null when average_price missing', () => {
    const entry = { ...SAMPLE } as ThalexPortfolioEntry;
    delete (entry as { average_price?: unknown }).average_price;
    expect(thalexPortfolioEntryToLeg(entry)).toBeNull();
  });

  it('synthesizes a deterministic legId', () => {
    const leg1 = thalexPortfolioEntryToLeg(SAMPLE);
    const leg2 = thalexPortfolioEntryToLeg({ ...SAMPLE, position: 5 });
    expect(leg1?.legId).toBe('thalex|BTC|2026-04-21|75000|call');
    expect(leg1?.legId).toBe(leg2?.legId);
  });

  it('filters mixed list, keeping valid options', () => {
    const legs = thalexPortfolioToLegs([
      SAMPLE,
      { ...SAMPLE, instrument_name: 'BAD' },
      { ...SAMPLE, instrument_name: 'ETH-28MAR26-3500-P', position: -1 },
    ]);
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.source === 'thalex')).toBe(true);
  });
});

describe('thalexAccountMargin', () => {
  it('maps required_margin to initial margin', () => {
    expect(
      thalexAccountMargin(
        {
          cash: [],
          unrealised_pnl: 0,
          margin: 1_000,
          required_margin: 400,
          remaining_margin: 600,
        },
        123,
      ),
    ).toEqual({ initialMarginUsd: 400, marginUsd: 1_000, remainingMarginUsd: 600, updatedAt: 123 });
  });

  it('returns null when margin fields are absent', () => {
    expect(thalexAccountMargin({ cash: [], unrealised_pnl: 0 }, 123)).toBeNull();
  });
});

describe('thalexAccountEquity', () => {
  it('values cash at the index and keeps session realised P&L apart from unrealised', () => {
    const equity = thalexAccountEquity(
      {
        cash: [
          { currency: 'USDC', balance: 150 },
          { currency: 'BTC', balance: 0.0001, collateral_index_price: 100_000 },
          { currency: 'ETH', balance: 1, collateral_index_price: null },
        ],
        unrealised_pnl: 5,
        session_realised_pnl: 40.95,
        margin: 165,
        required_margin: 0,
        remaining_margin: 165,
      },
      1_000,
    );
    expect(equity.cash.map((row) => row.valueUsd)).toEqual([150, 10, null]);
    expect(equity.cashUsd).toBe(160);
    expect(equity.equityUsd).toBeCloseTo(160 + 5 + 40.95, 9);
    expect(equity.unrealisedPnlUsd).toBe(5);
    expect(equity.sessionRealisedPnlUsd).toBe(40.95);
    expect(equity.marginUsd).toBe(165);
    expect(equity.updatedAt).toBe(1_000);
  });

  it('reports missing optional summary fields as null', () => {
    const equity = thalexAccountEquity({ cash: [], unrealised_pnl: 0 }, 0);
    expect(equity.sessionRealisedPnlUsd).toBeNull();
    expect(equity.marginUsd).toBeNull();
  });
});

describe('thalexCashTransactions', () => {
  it('sorts newest first and converts seconds to milliseconds', () => {
    const rows = thalexCashTransactions([
      { time: 10, asset: 'USDC', amount: -1, transaction_type: 'withdrawal fee' },
      {
        time: 20.5,
        asset: 'USDC',
        amount: 40.95,
        transaction_type: 'session settlement',
        instrument_name: 'BTC-23OCT26-88000-P',
        balance_after: 190.95,
        description: 'Session settlement',
      },
    ]);
    expect(rows).toEqual([
      {
        ts: 20_500,
        type: 'session settlement',
        asset: 'USDC',
        amount: 40.95,
        instrument: 'BTC-23OCT26-88000-P',
        balanceAfter: 190.95,
        description: 'Session settlement',
      },
      { ts: 10_000, type: 'withdrawal fee', asset: 'USDC', amount: -1, instrument: null, balanceAfter: null, description: null },
    ]);
  });
});

describe('thalexRealizedPnl', () => {
  const SETTLED_AT = Date.UTC(2026, 9, 21, 8);
  const close = (pnl: number, timestampMs: number): ExchangePortfolioTrade => ({
    venue: 'thalex',
    tradeId: `t-${timestampMs}`,
    orderId: null,
    groupId: null,
    instrumentName: 'BTC-21APR26-75000-C',
    underlying: 'BTC',
    expiry: '2026-04-21',
    strike: 75000,
    optionRight: 'call',
    direction: 'sell',
    amount: 1,
    priceUsd: 1_300,
    feeUsd: null,
    realizedPnlUsd: pnl,
    liquidityRole: null,
    timestampMs,
  });

  it('realises a close held across a settlement against average cost, not the reset start price', () => {
    // Bought 3 @ 1000, settled at 1150, then sold 1 @ 1300 this session.
    const realized = thalexRealizedPnl({
      dailyMarks: [
        {
          time: SETTLED_AT / 1000,
          instrument_name: 'BTC-21APR26-75000-C',
          position: 3,
          mark_price: 1_150,
          realized_position_pnl: 450,
        },
      ],
      trades: [close(150, SETTLED_AT + 3_600_000)],
      entries: [
        { instrument_name: 'BTC-21APR26-75000-C', position: 2, average_price: 1_000, start_price: 1_150 },
      ],
    });
    expect(realized).toBe(300);
  });

  it('is null when an open leg has no start price', () => {
    expect(
      thalexRealizedPnl({
        dailyMarks: [],
        trades: [],
        entries: [{ instrument_name: 'BTC-21APR26-75000-C', position: 1, average_price: 1_000 }],
      }),
    ).toBeNull();
  });
});
