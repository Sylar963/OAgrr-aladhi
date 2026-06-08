import { describe, expect, it } from 'vitest';
import { buildParadexQuote, paradexInstrumentDetails } from './state.js';
import { ParadexMarketSchema, ParadexSummarySchema } from './types.js';

// BaseAdapter-equivalent coercion helpers (protected in sdk-base; replicated for the unit test).
const safeNum = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const positiveOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const MARKET = ParadexMarketSchema.parse({
  symbol: 'BTC-USD-12JUN26-66000-C',
  base_currency: 'BTC',
  settlement_currency: 'USDC',
  asset_kind: 'OPTION',
  option_type: 'CALL',
  strike_price: '66000',
  expiry_at: 1781251200000,
  price_tick_size: '0.01',
  order_size_increment: '0.001',
  fee_config: { api_fee: { maker_fee: { fee: '0.000075' }, taker_fee: { fee: '0.000125' } } },
});

const SUMMARY = ParadexSummarySchema.parse({
  symbol: 'BTC-USD-12JUN26-66000-C',
  mark_price: '455.43645183',
  mark_iv: '0.49969521',
  greeks: { delta: '0.24458572', gamma: '0.00009747', vega: '20.25', theta: '-134.69', rho: '-0.0467' },
  last_traded_price: '',
  bid: '320',
  bid_size: '0.033',
  bid_iv: '0.43257569',
  ask: '480',
  ask_size: '0.033',
  ask_iv: '0.5145399',
  volume_24h: '0',
  created_at: 1780927581396,
  underlying_price: '63653.90898322',
  open_interest: '0',
  funding_rate: '',
});

describe('paradexInstrumentDetails', () => {
  it('extracts option fields from a /markets entry', () => {
    const d = paradexInstrumentDetails(MARKET)!;
    expect(d).not.toBeNull();
    expect(d.base).toBe('BTC');
    expect(d.right).toBe('call');
    expect(d.strike).toBe(66000);
    expect(d.expirationTimestampMs).toBe(1781251200000);
    expect(d.settle).toBe('USDC');
    expect(d.tickRaw).toBe('0.01');
    expect(d.makerFeeRaw).toBe('0.000075');
    expect(d.takerFeeRaw).toBe('0.000125');
  });

  it('returns null for non-option markets', () => {
    const perp = ParadexMarketSchema.parse({ symbol: 'BTC-USD-PERP', base_currency: 'BTC', asset_kind: 'PERP' });
    expect(paradexInstrumentDetails(perp)).toBeNull();
  });
});

describe('buildParadexQuote', () => {
  it('maps summary→LiveQuote with fraction IV and empty→null', () => {
    const q = buildParadexQuote(SUMMARY, safeNum, positiveOrNull);
    expect(q.bidPrice).toBe(320);
    expect(q.askPrice).toBe(480);
    expect(q.markPrice).toBeCloseTo(455.436, 2);
    expect(q.lastPrice).toBeNull(); // '' → null
    expect(q.underlyingPrice).toBeCloseTo(63653.9, 1);
    expect(q.indexPrice).toBeCloseTo(63653.9, 1);
    expect(q.openInterest).toBe(0);
    expect(q.volume24h).toBeNull(); // only USD volume is available
    expect(q.volume24hUsd).toBe(0);
    expect(q.greeks.markIv).toBeCloseTo(0.4997, 3); // FRACTION — no /100
    expect(q.greeks.delta).toBeCloseTo(0.2446, 3);
    expect(q.timestamp).toBe(1780927581396);
  });
});
