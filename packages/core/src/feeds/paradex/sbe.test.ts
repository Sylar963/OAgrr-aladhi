import { describe, expect, it } from 'vitest';
import { decodeParadexMarketSummarySbe } from './sbe.js';

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
});
