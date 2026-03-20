/**
 * Contract tests for Derive Zod schemas.
 *
 * All fixtures are copied verbatim from official Derive documentation:
 *   - ws-get-tickers.md   → DeriveTickerSchema (REST snapshot, abbreviated keys)
 *   - ws-ticker-slim.md   → DeriveTickerSchema (WS push, instrument_ticker wrapper)
 *   - ws-get-instruments.md → DeriveInstrumentSchema
 *
 * Critical protocol facts verified here:
 *   - ALL numeric values are strings (e.g. "B": "25.72862"), except stats.n
 *   - stats.n (trade count) is the ONLY actual number in ticker payloads
 *   - f (funding_rate) is null for options
 *   - option_pricing uses single-letter abbreviated keys
 *   - DeriveInstrumentSchema uses string fields for amounts and fees
 *   - option_details.expiry is Unix seconds, NOT milliseconds
 *   - option_details.strike is a string, NOT a number
 */

import { describe, it, expect } from 'vitest';
import { DeriveTickerSchema, DeriveInstrumentSchema } from './types.js';

// ─── DeriveTickerSchema — get_tickers response ─────────────────────────────

describe('DeriveTickerSchema (get_tickers response)', () => {
  // Exact ticker value from ws-get-tickers.md Example Response
  // (keyed as "BTC-20260327-155000-P" in the tickers dict)
  const getTickersDocFixture = {
    t: 1773963675269,
    A: '0',
    a: '0',
    B: '0',
    b: '0',
    f: null,
    option_pricing: {
      d: '-0.99999',
      t: '0',
      g: '0',
      v: '0',
      i: '0.70527',
      r: '1716.27839',
      f: '69727',
      m: '85272',
      df: '1',
      bi: '0',
      ai: '0',
    },
    I: '69739',
    M: '85272',
    stats: {
      c: '0',
      v: '0',
      pr: '0',
      n: 0,
      oi: '0',
      h: '0',
      l: '0',
      p: '0',
    },
    minp: '82263',
    maxp: '87954',
  };

  it('parses the get_tickers doc example verbatim', () => {
    const result = DeriveTickerSchema.safeParse(getTickersDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.t).toBe(1773963675269);
    expect(result.data.A).toBe('0');
    expect(result.data.B).toBe('0');
    expect(result.data.I).toBe('69739');
    expect(result.data.M).toBe('85272');
    expect(result.data.f).toBeNull();
  });

  it('parses option_pricing sub-object with all abbreviated string fields', () => {
    const result = DeriveTickerSchema.safeParse(getTickersDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const op = result.data.option_pricing;
    expect(op?.d).toBe('-0.99999');
    expect(op?.g).toBe('0');
    expect(op?.t).toBe('0');
    expect(op?.v).toBe('0');
    expect(op?.i).toBe('0.70527');
    expect(op?.r).toBe('1716.27839');
    expect(op?.f).toBe('69727');
    expect(op?.m).toBe('85272');
    expect(op?.df).toBe('1');
    expect(op?.bi).toBe('0');
    expect(op?.ai).toBe('0');
  });

  it('parses stats sub-object: string fields plus numeric stats.n', () => {
    const result = DeriveTickerSchema.safeParse(getTickersDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const s = result.data.stats;
    expect(s?.c).toBe('0');
    expect(s?.v).toBe('0');
    expect(s?.pr).toBe('0');
    // n is the ONLY non-string field in Derive tickers
    expect(s?.n).toBe(0);
    expect(typeof s?.n).toBe('number');
    expect(s?.oi).toBe('0');
    expect(s?.h).toBe('0');
    expect(s?.l).toBe('0');
    expect(s?.p).toBe('0');
  });

  it('parses minp and maxp as strings', () => {
    const result = DeriveTickerSchema.safeParse(getTickersDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.minp).toBe('82263');
    expect(result.data.maxp).toBe('87954');
  });

  it('accepts B and A as string "0" — the zero-market case from the docs', () => {
    // Deep-in-the-money put has bid=ask="0" per doc example
    const result = DeriveTickerSchema.safeParse(getTickersDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Confirm they are strings, not numbers — this is the contract
    expect(typeof result.data.B).toBe('string');
    expect(typeof result.data.A).toBe('string');
  });

  it('accepts f (funding_rate) as null for options', () => {
    // Docs explicitly state f is null for options
    const result = DeriveTickerSchema.safeParse(getTickersDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.f).toBeNull();
  });
});

// ─── DeriveTickerSchema — ticker_slim WS push ─────────────────────────────

describe('DeriveTickerSchema (ticker_slim instrument_ticker object)', () => {
  // Exact instrument_ticker object from ws-ticker-slim.md Push Data
  // (verified live 2026-03-19 per the doc)
  const tickerSlimDocFixture = {
    t: 1773963738391,
    A: '5.52',
    a: '58',
    B: '25.72862',
    b: '29',
    f: null,
    option_pricing: {
      d: '0.01561',
      t: '-15.67096',
      g: '0.00000667',
      v: '3.88184',
      i: '0.59308',
      r: '0.63993',
      f: '69827',
      m: '31',
      df: '0.999',
      bi: '0.58565',
      ai: '0.6478',
    },
    I: '69814',
    M: '31',
    stats: {
      c: '0',
      v: '0',
      pr: '0',
      n: 0,
      oi: '119.647',
      h: '0',
      l: '0',
      p: '0',
    },
    minp: '1',
    maxp: '478',
  };

  it('parses the ticker_slim doc example verbatim', () => {
    const result = DeriveTickerSchema.safeParse(tickerSlimDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.t).toBe(1773963738391);
    expect(result.data.B).toBe('25.72862');
    expect(result.data.A).toBe('5.52');
    expect(result.data.I).toBe('69814');
    expect(result.data.M).toBe('31');
  });

  it('parses non-zero bid and ask from active market (ticker_slim)', () => {
    const result = DeriveTickerSchema.safeParse(tickerSlimDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.B).toBe('25.72862');
    expect(result.data.b).toBe('29');
    expect(result.data.A).toBe('5.52');
    expect(result.data.a).toBe('58');
  });

  it('parses option_pricing with non-zero greek strings from active market', () => {
    const result = DeriveTickerSchema.safeParse(tickerSlimDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const op = result.data.option_pricing;
    expect(op?.d).toBe('0.01561');
    expect(op?.g).toBe('0.00000667');
    expect(op?.t).toBe('-15.67096');
    expect(op?.v).toBe('3.88184');
    expect(op?.i).toBe('0.59308');
    expect(op?.r).toBe('0.63993');
    expect(op?.bi).toBe('0.58565');
    expect(op?.ai).toBe('0.6478');
    expect(op?.df).toBe('0.999');
  });

  it('parses stats.oi as string (open interest from live market)', () => {
    const result = DeriveTickerSchema.safeParse(tickerSlimDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    // oi is "119.647" (string), not a number
    expect(result.data.stats?.oi).toBe('119.647');
    expect(typeof result.data.stats?.oi).toBe('string');
  });

  it('confirms stats.n is a number (only non-string field in the ticker)', () => {
    const result = DeriveTickerSchema.safeParse(tickerSlimDocFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.stats?.n).toBe(0);
    expect(typeof result.data.stats?.n).toBe('number');
  });

  it('rejects ticker where B (best_bid_price) is a number instead of string', () => {
    // Derive sends ALL prices as strings — a number violates the contract
    const bad = { ...tickerSlimDocFixture, B: 25.72862 };
    const result = DeriveTickerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects ticker where A (best_ask_price) is a number instead of string', () => {
    const bad = { ...tickerSlimDocFixture, A: 5.52 };
    const result = DeriveTickerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects ticker where I (index_price) is a number instead of string', () => {
    const bad = { ...tickerSlimDocFixture, I: 69814 };
    const result = DeriveTickerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects ticker where M (mark_price) is a number instead of string', () => {
    const bad = { ...tickerSlimDocFixture, M: 31 };
    const result = DeriveTickerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects ticker where option_pricing.d (delta) is a number instead of string', () => {
    const bad = {
      ...tickerSlimDocFixture,
      option_pricing: { ...tickerSlimDocFixture.option_pricing, d: 0.01561 },
    };
    const result = DeriveTickerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts ticker with option_pricing absent (perp / non-option)', () => {
    const perpFixture = {
      t: 1773963738391,
      A: '50000.5',
      a: '1',
      B: '49999.5',
      b: '2',
      f: '0.0001',
      I: '50000',
      M: '50000.25',
      stats: {
        c: '1.5',
        v: '120.5',
        pr: '0',
        n: 42,
        oi: '500',
        h: '51000',
        l: '48000',
        p: '49500',
      },
      minp: '45000',
      maxp: '55000',
    };
    const result = DeriveTickerSchema.safeParse(perpFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.option_pricing).toBeUndefined();
  });

  it('accepts ticker with stats absent', () => {
    const noStats = {
      t: 1773963738391,
      A: '5.52',
      a: '58',
      B: '25.72862',
      b: '29',
      f: null,
      I: '69814',
      M: '31',
    };
    const result = DeriveTickerSchema.safeParse(noStats);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.stats).toBeUndefined();
  });

  it('accepts ticker with minp and maxp absent', () => {
    const noMinMax = {
      t: 1773963738391,
      A: '5.52',
      a: '58',
      B: '25.72862',
      b: '29',
      f: null,
      I: '69814',
      M: '31',
    };
    const result = DeriveTickerSchema.safeParse(noMinMax);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.minp).toBeUndefined();
    expect(result.data.maxp).toBeUndefined();
  });
});

// ─── DeriveTickerSchema — rejection of truly malformed data ────────────────

describe('DeriveTickerSchema (malformed data rejection)', () => {
  it('rejects null payload', () => {
    const result = DeriveTickerSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects array payload', () => {
    const result = DeriveTickerSchema.safeParse([{ B: '100', A: '101' }]);
    expect(result.success).toBe(false);
  });

  it('rejects primitive string payload', () => {
    const result = DeriveTickerSchema.safeParse('BTC-20260327-84000-C');
    expect(result.success).toBe(false);
  });
});

// ─── DeriveInstrumentSchema ────────────────────────────────────────────────

describe('DeriveInstrumentSchema', () => {
  // Exact element from ws-get-instruments.md Example Response
  const docFixture = {
    instrument_type: 'option',
    instrument_name: 'BTC-20260327-84000-P',
    scheduled_activation: 1751014800,
    scheduled_deactivation: 1774598340,
    is_active: true,
    tick_size: '1',
    minimum_amount: '0.01',
    maximum_amount: '1000',
    amount_step: '0.00001',
    mark_price_fee_rate_cap: '0.125',
    maker_fee_rate: '0.0003',
    taker_fee_rate: '0.0003',
    option_details: {
      expiry: 1774598400,
      index: 'BTC-USD',
      option_type: 'P',
      strike: '84000',
      settlement_price: null,
    },
    quote_currency: 'USDC',
  };

  it('parses the get_instruments doc example verbatim', () => {
    const result = DeriveInstrumentSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.instrument_name).toBe('BTC-20260327-84000-P');
    expect(result.data.instrument_type).toBe('option');
    expect(result.data.is_active).toBe(true);
    expect(result.data.quote_currency).toBe('USDC');
  });

  it('parses tick_size, minimum_amount, maximum_amount as strings', () => {
    const result = DeriveInstrumentSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.tick_size).toBe('1');
    expect(result.data.minimum_amount).toBe('0.01');
    expect(result.data.maximum_amount).toBe('1000');
    expect(result.data.amount_step).toBe('0.00001');
  });

  it('parses maker_fee_rate and taker_fee_rate as strings', () => {
    const result = DeriveInstrumentSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.maker_fee_rate).toBe('0.0003');
    expect(result.data.taker_fee_rate).toBe('0.0003');
  });

  it('parses option_details with expiry as number (Unix seconds, NOT ms)', () => {
    const result = DeriveInstrumentSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const od = result.data.option_details;
    expect(od?.expiry).toBe(1774598400);
    expect(typeof od?.expiry).toBe('number');
    // Sanity check: this is seconds (10 digits), not ms (13 digits)
    expect(String(od?.expiry).length).toBe(10);
  });

  it('parses option_details.index as string', () => {
    const result = DeriveInstrumentSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.option_details?.index).toBe('BTC-USD');
  });

  it('parses option_details.option_type as "P" (put)', () => {
    const result = DeriveInstrumentSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.option_details?.option_type).toBe('P');
  });

  it('parses option_details.strike as a string, not a number', () => {
    const result = DeriveInstrumentSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.option_details?.strike).toBe('84000');
    expect(typeof result.data.option_details?.strike).toBe('string');
  });

  it('parses option_details.settlement_price as null when not yet settled', () => {
    const result = DeriveInstrumentSchema.safeParse(docFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.option_details?.settlement_price).toBeNull();
  });

  it('parses call option (C) variant', () => {
    const callFixture = {
      ...docFixture,
      instrument_name: 'BTC-20260327-84000-C',
      option_details: {
        ...docFixture.option_details,
        option_type: 'C',
      },
    };
    const result = DeriveInstrumentSchema.safeParse(callFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.option_details?.option_type).toBe('C');
  });

  it('accepts instrument without option_details (perp or erc20 type)', () => {
    const perpFixture = {
      instrument_type: 'perp',
      instrument_name: 'BTC-PERP',
      is_active: true,
      tick_size: '0.1',
      minimum_amount: '0.001',
      maximum_amount: '100',
      amount_step: '0.001',
      maker_fee_rate: '0.0002',
      taker_fee_rate: '0.0005',
      quote_currency: 'USDC',
    };
    const result = DeriveInstrumentSchema.safeParse(perpFixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.option_details).toBeUndefined();
  });

  it('accepts instrument with optional is_active field absent', () => {
    const noActive = { ...docFixture };
    const { is_active: _removed, ...withoutActive } = noActive;
    const result = DeriveInstrumentSchema.safeParse(withoutActive);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.is_active).toBeUndefined();
  });

  it('rejects instrument missing required instrument_name', () => {
    const bad = { instrument_type: 'option', is_active: true };
    const result = DeriveInstrumentSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects instrument missing required instrument_type', () => {
    const bad = { instrument_name: 'BTC-20260327-84000-P', is_active: true };
    const result = DeriveInstrumentSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects instrument where option_details.expiry is a string instead of number', () => {
    // expiry must be a number (Unix seconds) — not a string
    const bad = {
      ...docFixture,
      option_details: {
        ...docFixture.option_details,
        expiry: '1774598400',
      },
    };
    const result = DeriveInstrumentSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects instrument where tick_size is a number instead of string', () => {
    // Derive sends amount fields as strings — numbers violate the contract
    const bad = { ...docFixture, tick_size: 1 };
    const result = DeriveInstrumentSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects instrument where is_active is a string instead of boolean', () => {
    const bad = { ...docFixture, is_active: 'true' };
    const result = DeriveInstrumentSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects null payload', () => {
    const result = DeriveInstrumentSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('rejects array payload', () => {
    const result = DeriveInstrumentSchema.safeParse([docFixture]);
    expect(result.success).toBe(false);
  });
});
