import { describe, expect, it } from 'vitest';
import { EMPTY_GREEKS } from '../../core/types.js';
import type { LiveQuote } from '../shared/sdk-base.js';
import { buildThalexInstrument, mergeThalexTicker } from './state.js';
import type { ThalexInstrument, ThalexTicker } from './types.js';

function emptyQuote(): LiveQuote {
  return {
    bidPrice: null,
    askPrice: null,
    bidSize: null,
    askSize: null,
    markPrice: null,
    lastPrice: null,
    underlyingPrice: null,
    indexPrice: null,
    volume24h: null,
    openInterest: null,
    openInterestUsd: null,
    volume24hUsd: null,
    greeks: { ...EMPTY_GREEKS },
    timestamp: 0,
  };
}

const deps = {
  buildCanonicalSymbol: (b: string, s: string, e: string, k: number, r: 'call' | 'put') =>
    `${b}/USD:${s}-${e.slice(2).replace(/-/g, '')}-${k}-${r === 'call' ? 'C' : 'P'}`,
  parseExpiry: (raw: string) => {
    const m = raw.match(/^(\d+)([A-Z]{3})(\d{2})$/);
    if (!m) return raw;
    const months: Record<string, string> = {
      JAN: '01',
      FEB: '02',
      MAR: '03',
      APR: '04',
      MAY: '05',
      JUN: '06',
      JUL: '07',
      AUG: '08',
      SEP: '09',
      OCT: '10',
      NOV: '11',
      DEC: '12',
    };
    return `20${m[3]!}-${months[m[2]!] ?? '01'}-${m[1]!.padStart(2, '0')}`;
  },
};

describe('buildThalexInstrument', () => {
  it('parses a BTC put option', () => {
    const row: ThalexInstrument = {
      instrument_name: 'BTC-21APR26-75000-P',
      underlying: 'BTCUSD',
      type: 'option',
      option_type: 'put',
      expiry_date: '2026-04-21',
      expiration_timestamp: 1776758400,
      strike_price: 75000,
      tick_size: 5,
      min_order_amount: 0.01,
    };
    const inst = buildThalexInstrument(row, deps);
    expect(inst).not.toBeNull();
    expect(inst).toMatchObject({
      exchangeSymbol: 'BTC-21APR26-75000-P',
      base: 'BTC',
      settle: 'USD',
      expiry: '2026-04-21',
      strike: 75000,
      right: 'put',
      inverse: false,
      contractSize: 1,
      tickSize: 5,
      minQty: 0.01,
      makerFee: null,
      takerFee: null,
    });
    // seconds → ms
    expect(inst?.expirationTimestamp).toBe(1776758400 * 1000);
  });

  it('returns null for non-option types', () => {
    const row: ThalexInstrument = {
      instrument_name: 'BTC-PERPETUAL',
      underlying: 'BTCUSD',
      type: 'perpetual',
    };
    expect(buildThalexInstrument(row, deps)).toBeNull();
  });

  it('returns null when the symbol does not match the option regex', () => {
    const row: ThalexInstrument = {
      instrument_name: 'BTC-PERPETUAL',
      underlying: 'BTCUSD',
      type: 'option',
    };
    expect(buildThalexInstrument(row, deps)).toBeNull();
  });
});

describe('mergeThalexTicker', () => {
  it('fills bid/ask/mark/iv/delta and converts mark_timestamp s→ms', () => {
    const t: ThalexTicker = {
      mark_price: 53.21791443839902,
      mark_timestamp: 1776715497.7188172,
      best_bid_price: 40,
      best_bid_amount: 0.26,
      best_ask_price: 75,
      best_ask_amount: 0.25,
      last_price: 345,
      iv: 0.36920014956066893,
      delta: -0.10629456689577088,
      volume_24h: 0.28,
      value_24h: 121.5,
      index: 76283.25916666667,
      forward: 76276.40187647431,
      open_interest: 0.18,
    };
    const q = mergeThalexTicker(t, undefined, emptyQuote());
    expect(q.bidPrice).toBe(40);
    expect(q.askPrice).toBe(75);
    expect(q.bidSize).toBe(0.26);
    expect(q.askSize).toBe(0.25);
    expect(q.markPrice).toBeCloseTo(53.2179, 3);
    expect(q.lastPrice).toBe(345);
    expect(q.underlyingPrice).toBeCloseTo(76283.26, 1);
    expect(q.greeks.markIv).toBeCloseTo(0.3692, 3);
    expect(q.greeks.delta).toBeCloseTo(-0.1063, 3);
    expect(q.volume24h).toBe(0.28);
    expect(q.volume24hUsd).toBe(121.5);
    expect(q.openInterest).toBe(0.18);
    expect(q.timestamp).toBe(Math.round(1776715497.7188172 * 1000));
  });

  it('preserves gamma/theta/vega from previous (Thalex never sets them)', () => {
    const prev = emptyQuote();
    prev.greeks = { ...prev.greeks, gamma: 0.01, theta: -12.5, vega: 42 };
    const q = mergeThalexTicker(
      { mark_timestamp: 1, iv: 0.5, delta: 0.5 },
      prev,
      emptyQuote(),
    );
    expect(q.greeks.gamma).toBe(0.01);
    expect(q.greeks.theta).toBe(-12.5);
    expect(q.greeks.vega).toBe(42);
    expect(q.greeks.markIv).toBe(0.5);
  });

  it('preserves bid/ask on a partial update that omits them', () => {
    const prev = emptyQuote();
    prev.bidPrice = 10;
    prev.askPrice = 12;
    const q = mergeThalexTicker(
      { mark_timestamp: 2, mark_price: 11 },
      prev,
      emptyQuote(),
    );
    expect(q.bidPrice).toBe(10);
    expect(q.askPrice).toBe(12);
    expect(q.markPrice).toBe(11);
  });
});
