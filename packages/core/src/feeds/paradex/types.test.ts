import { describe, expect, it } from 'vitest';
import {
  ParadexMarketsResponseSchema,
  ParadexSummaryResponseSchema,
  ParadexTradesResponseSchema,
} from './types.js';

// Verbatim from references/options-docs/paradex/rest-markets-option.json
const MARKET = {
  symbol: 'BTC-USD-12JUN26-66000-C',
  base_currency: 'BTC',
  quote_currency: 'USD',
  settlement_currency: 'USDC',
  order_size_increment: '0.001',
  price_tick_size: '0.01',
  min_notional: '20',
  open_at: 1779957765787,
  expiry_at: 1781251200000,
  asset_kind: 'OPTION',
  option_type: 'CALL',
  strike_price: '66000',
  fee_config: {
    api_fee: {
      maker_fee: { fee: '0.000075', fee_cap: '0.125', fee_floor: '-0.125' },
      taker_fee: { fee: '0.000125', fee_cap: '0.125', fee_floor: '-0.125' },
    },
  },
};

// Verbatim from references/options-docs/paradex/rest-markets-summary-option.json
const SUMMARY = {
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
};

describe('paradex schemas', () => {
  it('parses a /markets option entry', () => {
    const parsed = ParadexMarketsResponseSchema.parse({ results: [MARKET] });
    expect(parsed.results[0]!.asset_kind).toBe('OPTION');
    expect(parsed.results[0]!.option_type).toBe('CALL');
    expect(parsed.results[0]!.strike_price).toBe('66000');
    expect(parsed.results[0]!.expiry_at).toBe(1781251200000);
    expect(parsed.results[0]!.fee_config?.api_fee?.taker_fee?.fee).toBe('0.000125');
  });

  it('parses a /markets/summary entry incl. nested greeks and empty strings', () => {
    const parsed = ParadexSummaryResponseSchema.parse({ results: [SUMMARY] });
    const s = parsed.results[0]!;
    expect(s.mark_iv).toBe('0.49969521');
    expect(s.greeks?.delta).toBe('0.24458572');
    expect(s.last_traded_price).toBe(''); // empty string, not null — coerced later
    expect(s.open_interest).toBe('0');
  });

  // Verbatim from references/options-docs/paradex/rest-trades.json
  it('parses a /trades option entry with explicit taker side', () => {
    const TRADE = {
      id: '1780562498430201709229980001',
      market: 'BTC-USD-31JUL26-58000-P',
      side: 'SELL',
      size: '0.1',
      price: '2279.52',
      created_at: 1780562498436,
      trade_type: 'RPI',
    };
    const parsed = ParadexTradesResponseSchema.parse({ results: [TRADE] });
    const t = parsed.results[0]!;
    expect(t.side).toBe('SELL'); // explicit taker side, not sign-of-size
    expect(t.price).toBe('2279.52'); // string — coerced downstream
    expect(t.created_at).toBe(1780562498436); // unix ms
    expect(t.trade_type).toBe('RPI');
  });
});
