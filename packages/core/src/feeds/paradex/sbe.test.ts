import { describe, expect, it } from 'vitest';
import {
  decodeParadexMarketSummarySbe,
  decodeParadexMarketSummaryValues,
  PARADEX_SBE_IGNORED,
} from './sbe.js';
import { buildParadexQuote } from './state.js';

const OPTION_FRAME = Buffer.from(
  'f000040001000100686ed8ac055c06000000000000000000d5c69bb61400000039facffe2100000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000008000000000000000006067b6fffffffffffbdae40b00000000000000000000008000000000000000800000000000000080a1ceb90500000000b82600000000000008f5a40200000000f54b0ff8ffffffffb1cf6bfaffffffffc21e060000000000ed3e000000000000f026000000000000000000000000008000000000000000800000000000000080c04347000000000000000000000000000000000000000080155a45432d5553442d33304f435432362d3630302d43',
  'hex',
);

describe('decodeParadexMarketSummarySbe', () => {
  it('decodes a live schema 1:1 option summary frame', () => {
    expect(decodeParadexMarketSummarySbe(OPTION_FRAME)).toMatchObject({
      symbol: 'ZEC-USD-30OCT26-600-C',
      mark_price: '889.63008213',
      underlying_price: '1460.08963641',
      last_traded_price: '0',
      bid: null,
      ask: null,
      mark_iv: '1.99547643',
      bid_size: null,
      ask_size: null,
      open_interest: '0',
      volume_24h: '0',
      created_at: 1790029304721,
      greeks: {
        delta: '0.96063137',
        gamma: '0.00009912',
        vega: '0.44365064',
        theta: '-1.33215243',
        rho: '-0.93597775',
        volga: '0.0040109',
        vanna: '0.00016109',
      },
    });
  });

  it('ignores other templates and truncated frames', () => {
    const heartbeat = Buffer.from(OPTION_FRAME);
    heartbeat.writeUInt16LE(40, 2);

    expect(decodeParadexMarketSummarySbe(heartbeat)).toBeNull();
    expect(decodeParadexMarketSummarySbe(OPTION_FRAME.subarray(0, 100))).toBeNull();
  });

  it('skips decoding frames for markets the caller does not track', () => {
    expect(decodeParadexMarketSummarySbe(OPTION_FRAME, () => false)).toBe(PARADEX_SBE_IGNORED);
    expect(decodeParadexMarketSummarySbe(OPTION_FRAME, () => true)).toMatchObject({
      symbol: expect.any(String),
    });
  });
});

describe('decodeParadexMarketSummaryValues', () => {
  const safeNum = (v: unknown) => {
    if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const positiveOrNull = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const quoteOf = (frame: Buffer, decode: typeof decodeParadexMarketSummaryValues | typeof decodeParadexMarketSummarySbe) => {
    const summary = decode(frame);
    if (summary === null || summary === PARADEX_SBE_IGNORED) throw new Error('undecodable');
    return buildParadexQuote(summary, safeNum, positiveOrNull);
  };

  it('builds the same quote as the string decoder for the live fixture', () => {
    expect(quoteOf(OPTION_FRAME, decodeParadexMarketSummaryValues)).toEqual(
      quoteOf(OPTION_FRAME, decodeParadexMarketSummarySbe),
    );
  });

  it('matches Number(decimal string) for every int64 field across the exact-range boundary', () => {
    const offsets = [16, 24, 32, 40, 48, 56, 64, 72, 96, 104, 112, 128, 136, 144, 152, 160, 168, 176, 200, 208];
    const edges = [
      0n, 1n, -1n, 99_999_999n, 100_000_000n, -100_000_001n,
      2n ** 53n - 1n, 2n ** 53n, 2n ** 53n + 1n, -(2n ** 53n), -(2n ** 53n) - 1n,
      2n ** 62n + 12_345n, -(2n ** 63n) + 1n, 2n ** 63n - 1n, -(2n ** 63n),
    ];
    let seed = 0x9e3779b9;
    const rand32 = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return BigInt(seed);
    };
    const values = [...edges];
    for (let i = 0; i < 4_000; i += 1) {
      const raw = (rand32() << 32n) | rand32();
      values.push(BigInt.asIntN(64, i % 2 === 0 ? raw : raw >> BigInt(rand32() % 40n)));
    }
    for (const [i, value] of values.entries()) {
      const frame = Buffer.from(OPTION_FRAME);
      frame.writeBigInt64LE(value, 8 + offsets[i % offsets.length]!);
      expect(quoteOf(frame, decodeParadexMarketSummaryValues)).toEqual(
        quoteOf(frame, decodeParadexMarketSummarySbe),
      );
    }
  });

  it('keeps the tracked-symbol filter and frame validation', () => {
    expect(decodeParadexMarketSummaryValues(OPTION_FRAME, () => false)).toBe(PARADEX_SBE_IGNORED);
    expect(decodeParadexMarketSummaryValues(OPTION_FRAME.subarray(0, 100))).toBeNull();
  });
});
