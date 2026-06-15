/**
 * Coincall feed — doc-driven contract tests.
 *
 * REST fixtures captured from live:
 *   references/options-docs/coincall/{time,config,instruments-BTC}.json
 * WS fixtures copied verbatim from Coincall docs:
 *   references/options-docs/coincall/option_ws_en.md
 *
 * Purpose: every schema accepts the exact shapes Coincall returns.
 */

import { describe, it, expect } from 'vitest';
import {
  COINCALL_OPTION_SYMBOL_RE,
  CoincallBsInfoMessageSchema,
  CoincallChainResponseSchema,
  CoincallHeartbeatAckSchema,
  CoincallInstrumentSchema,
  CoincallInstrumentsResponseSchema,
  CoincallOptionDetailSchema,
  CoincallOrderBookMessageSchema,
  CoincallPublicConfigSchema,
  CoincallTOptionMessageSchema,
  CoincallTimeSchema,
} from './types.js';

// ── /time ──────────────────────────────────────────────────────
// Source: live capture 2026-04-20, envelope unwrapped to `data`.
const TIME_FIXTURE = { serverTime: 1776702613959 };

// ── /open/option/getInstruments/BTC ────────────────────────────
// Source: live capture 2026-04-20.
const INSTRUMENT_FIXTURE = {
  baseCurrency: 'BTC',
  startTimestamp: 1776414600036,
  expirationTimestamp: 1776758400000,
  strike: 67000,
  symbolName: 'BTCUSD-21APR26-67000-C',
  isActive: true,
  minQty: 0.01,
  tickSize: 1,
};

// ── /open/public/config/v1 ─────────────────────────────────────
// Source: live capture 2026-04-20, optionConfig["BTCUSD"].
const BTC_OPTION_CONFIG_FIXTURE = {
  symbol: 'BTCUSD',
  takerFee: 0.0004,
  maxOrderNumber: 200,
  multiplier: 0.01,
  settle: 'USD',
  priceDecimal: 2,
  limitMaxQty: 1000000,
  tickDecimal: 1,
  tickSize: 0.1,
  greeksDecimal: 5,
  makerFee: 0.0003,
  marketMaxQty: 1000,
  qtyDecimal: 2,
  maxPositionQty: 1000,
  base: 'BTC',
};

// ── WS: bsInfo push ────────────────────────────────────────────
// Source: _option_ws_en.md, "Pricing Information" section.
const BSINFO_FIXTURE = {
  dt: 3,
  c: 20,
  d: {
    uv: 30783000.0,
    rt: 2081914160,
    mp: 834.28262809,
    lp: 834.29106136,
    ip: 31059.68,
    delta: 0.34898,
    h: 783.67149194,
    l: 665.61113639,
    iv: 0.4728,
    theta: -29.14546,
    cp: -64.84120504,
    pr0: 899.1322664,
    cr: -0.0721,
    s: 'BTCUSD-28JUL23-33000-C',
    uv24: 30783000.0,
    v: 1000.0,
    v24: 1000.0,
    oi: 1000.0,
    up: 31248.97,
    gamma: 0.0001,
    vega: 29.70793,
    ts: 1688449285840,
  },
};

// ── WS: tOption push ───────────────────────────────────────────
// Source: _option_ws_en.md, "Option Chain Data" section.
const TOPTION_FIXTURE = {
  dt: 4,
  c: 20,
  d: [
    {
      mp: 4038.5855,
      lp: 4038.5855,
      delta: 1.0,
      theta: 0.0,
      cp: -124.2124,
      biv: 0.01,
      aiv: 0.01,
      cr: -0.0298,
      bs: 0.2,
      as: 0,
      s: 'BTCUSD-4JUL23-27000-C',
      v: 1.0,
      ask: 0,
      v24: 1.0,
      oi: 1.0,
      upv: 0,
      up: 31038.5855,
      bid: 1,
      gamma: 0.0,
      vega: 0.0,
      ts: 1688452774463,
    },
  ],
};

// ── WS: heartbeat ack ──────────────────────────────────────────
// Source: _option_ws_en.md, "HeartBeat" section.
const HEARTBEAT_ACK_FIXTURE = { c: 11, rc: 1 };

// ── WS: orderBook push ─────────────────────────────────────────
// Source: _option_ws_en.md, "OrderBook" section.
const ORDERBOOK_FIXTURE = {
  dt: 5,
  c: 20,
  d: {
    s: 'BTCUSD-4JUL23-27000-C',
    asks: [{ pr: '4038.58', sz: '1' }],
    bids: [{ pr: '1', sz: '0.2' }],
    ts: 1688453641701,
  },
};

describe('Coincall types', () => {
  it('accepts /time payload', () => {
    expect(CoincallTimeSchema.safeParse(TIME_FIXTURE).success).toBe(true);
  });

  it('accepts a getInstruments row', () => {
    expect(CoincallInstrumentSchema.safeParse(INSTRUMENT_FIXTURE).success).toBe(true);
  });

  it('accepts an array of instruments', () => {
    const result = CoincallInstrumentsResponseSchema.safeParse([INSTRUMENT_FIXTURE]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0]?.symbolName).toBe('BTCUSD-21APR26-67000-C');
  });

  it('accepts an optionConfig record', () => {
    const result = CoincallPublicConfigSchema.safeParse({
      optionConfig: { BTCUSD: BTC_OPTION_CONFIG_FIXTURE },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.optionConfig['BTCUSD']?.settle).toBe('USD');
      expect(result.data.optionConfig['BTCUSD']?.multiplier).toBe(0.01);
    }
  });

  it('coerces numeric-string config values', () => {
    const result = CoincallPublicConfigSchema.safeParse({
      optionConfig: {
        BTCUSD: { ...BTC_OPTION_CONFIG_FIXTURE, takerFee: '0.0004', makerFee: '0.0003' },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.optionConfig['BTCUSD']?.takerFee).toBe(0.0004);
    }
  });

  it('accepts a bsInfo push', () => {
    const result = CoincallBsInfoMessageSchema.safeParse(BSINFO_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.d.s).toBe('BTCUSD-28JUL23-33000-C');
      expect(result.data.d.iv).toBe(0.4728);
      expect(result.data.d.mp).toBe(834.28262809);
      // bsInfo does not include bid/ask.
      expect((result.data.d as Record<string, unknown>)['bid']).toBeUndefined();
    }
  });

  it('accepts a bsInfo push with null numeric fields', () => {
    // Coincall sends null for empty fields; null must not drop the instrument's
    // mark/iv/greeks update.
    const result = CoincallBsInfoMessageSchema.safeParse({
      ...BSINFO_FIXTURE,
      d: { ...BSINFO_FIXTURE.d, mp: null, iv: null, delta: null, oi: null },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.d.mp).toBeNull();
      expect(result.data.d.iv).toBeNull();
    }
  });

  it('accepts a tOption push', () => {
    const result = CoincallTOptionMessageSchema.safeParse(TOPTION_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      const first = result.data.d[0]!;
      expect(first.s).toBe('BTCUSD-4JUL23-27000-C');
      expect(first.bid).toBe(1);
      expect(first.ask).toBe(0);
      expect(first.biv).toBe(0.01);
      expect(first.aiv).toBe(0.01);
    }
  });

  it('coerces numeric-string tOption fields', () => {
    const result = CoincallTOptionMessageSchema.safeParse({
      ...TOPTION_FIXTURE,
      d: [
        {
          ...TOPTION_FIXTURE.d[0],
          bid: '1',
          ask: '0',
          biv: '0.01',
          aiv: '0.01',
          ts: '1688452774463',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const first = result.data.d[0]!;
      expect(first.bid).toBe(1);
      expect(first.ask).toBe(0);
      expect(first.biv).toBe(0.01);
      expect(first.ts).toBe(1688452774463);
    }
  });

  it('accepts null bid/ask/size/iv fields without dropping the whole batch', () => {
    // Production sends `null` for empty quote sides. Because the push is an
    // array, one entry rejecting null would drop every contract in the expiry.
    const result = CoincallTOptionMessageSchema.safeParse({
      ...TOPTION_FIXTURE,
      d: [
        { ...TOPTION_FIXTURE.d[0], bid: null, ask: null, bs: null, as: null, biv: null, aiv: null },
        { ...TOPTION_FIXTURE.d[0], s: 'BTCUSD-4JUL23-28000-C' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.d).toHaveLength(2);
      expect(result.data.d[0]?.bid).toBeNull();
      expect(result.data.d[0]?.ask).toBeNull();
      // The valid sibling entry still survives.
      expect(result.data.d[1]?.bid).toBe(1);
    }
  });

  it('accepts a heartbeat ack', () => {
    const result = CoincallHeartbeatAckSchema.safeParse(HEARTBEAT_ACK_FIXTURE);
    expect(result.success).toBe(true);
  });

  it('accepts an orderBook push and coerces top levels to numbers', () => {
    const result = CoincallOrderBookMessageSchema.safeParse(ORDERBOOK_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.d.bids[0]?.pr).toBe(1);
      expect(result.data.d.asks[0]?.sz).toBe(1);
    }
  });

  it('rejects a bsInfo push with wrong dt', () => {
    const bad = { ...BSINFO_FIXTURE, dt: 99 };
    expect(CoincallBsInfoMessageSchema.safeParse(bad).success).toBe(false);
  });
});

describe('Coincall symbol regex', () => {
  it('matches a BTC call', () => {
    const m = COINCALL_OPTION_SYMBOL_RE.exec('BTCUSD-14SEP23-22500-C');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('BTC');
    expect(m?.[2]).toBe('14SEP23');
    expect(m?.[3]).toBe('22500');
    expect(m?.[4]).toBe('C');
  });

  it('matches an ETH put', () => {
    const m = COINCALL_OPTION_SYMBOL_RE.exec('ETHUSD-28MAR26-3000-P');
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe('ETH');
    expect(m?.[4]).toBe('P');
  });

  it('matches a single-digit day', () => {
    const m = COINCALL_OPTION_SYMBOL_RE.exec('BTCUSD-4JUL23-27000-C');
    expect(m).not.toBeNull();
    expect(m?.[2]).toBe('4JUL23');
  });

  it('rejects Bybit-style symbols', () => {
    expect(COINCALL_OPTION_SYMBOL_RE.exec('BTC-28MAR26-60000-C')).toBeNull();
  });

  it('rejects a missing right suffix', () => {
    expect(COINCALL_OPTION_SYMBOL_RE.exec('BTCUSD-14SEP23-22500')).toBeNull();
  });
});

// ── REST: GET /open/option/get/v1/{index} (bulk chain) ─────────
// Source: live capture 2026-06-01 (HYPEUSD, 26JUN26), envelope unwrapped to `data`.
// The 30-put carried 1015 contracts of OI that the WS market feed reports as 0.
describe('CoincallChainResponseSchema', () => {
  it('parses call/put legs, coerces string numbers, tolerates a one-sided strike', () => {
    const result = CoincallChainResponseSchema.safeParse([
      {
        strike: 30,
        callOption: { symbol: 'HYPEUSD-26JUN26-30.0-C', openInterest: 0, volume: 0 },
        putOption: { symbol: 'HYPEUSD-26JUN26-30.0-P', openInterest: '1015', volume: '3' },
      },
      {
        strike: 90,
        callOption: { symbol: 'HYPEUSD-26JUN26-90.0-C', openInterest: 15 },
        putOption: null,
      },
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]?.putOption?.openInterest).toBe(1015);
      expect(result.data[0]?.callOption?.openInterest).toBe(0);
      expect(result.data[1]?.putOption).toBeNull();
      expect(result.data[1]?.callOption?.openInterest).toBe(15);
    }
  });
});

// ── REST: GET /open/option/detail/v1/{symbol} (per-contract) ──
// Source: live capture 2026-06-01. The only endpoint carrying 24h volume.
describe('CoincallOptionDetailSchema', () => {
  it('parses OI, 24h volume (+USD), underlyingPrice and ignores extra fields', () => {
    const result = CoincallOptionDetailSchema.safeParse({
      symbol: 'HYPEUSD-26JUN26-72.0-P',
      openInterest: 39,
      volume24h: '17',
      volumeUsd24h: 1246.308,
      underlyingPrice: 74.39,
      markPrice: 1.23,
      delta: -0.5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openInterest).toBe(39);
      expect(result.data.volume24h).toBe(17);
      expect(result.data.volumeUsd24h).toBeCloseTo(1246.308, 3);
      expect(result.data.underlyingPrice).toBe(74.39);
    }
  });
});
