import {
  EMPTY_GREEKS,
  type NormalizedOptionContract,
  type VenueOptionChain,
} from '../../core/types.js';

export const TEST_NOW = Date.parse('2026-11-20T18:00:00Z');
export const TEST_EXPIRY = '2026-12-20';
export const TEST_EXPIRY_TS = Date.parse(`${TEST_EXPIRY}T08:00:00Z`);
export function contract(
  right: 'put' | 'call',
  now = TEST_NOW,
  bidIv = right === 'put' ? 0.6 : 0.5,
  askIv = bidIv + 0.02,
): NormalizedOptionContract {
  return {
    venue: 'deribit',
    symbol: right,
    exchangeSymbol: right,
    base: 'BTC',
    settle: 'BTC',
    expiry: TEST_EXPIRY,
    expiryTs: TEST_EXPIRY_TS,
    strike: right === 'put' ? 70_000 : 110_000,
    right,
    inverse: true,
    contractSize: 1,
    tickSize: null,
    minQty: null,
    makerFee: null,
    takerFee: null,
    greeks: { ...EMPTY_GREEKS, delta: right === 'put' ? -0.25 : 0.25, bidIv, askIv },
    quote: {
      bid: { raw: 0.01, rawCurrency: 'BTC', usd: 1000, usdPerBase: 1000 },
      ask: { raw: 0.011, rawCurrency: 'BTC', usd: 1100, usdPerBase: 1100 },
      mark: { raw: 0.0105, rawCurrency: 'BTC', usd: 1050 },
      last: null,
      bidSize: 1,
      askSize: 1,
      underlyingPriceUsd: 100_000,
      indexPriceUsd: 100_000,
      volume24h: null,
      openInterest: null,
      openInterestUsd: null,
      volume24hUsd: null,
      estimatedFees: null,
      timestamp: now,
      source: 'ws',
    },
  };
}
export function chain(now = TEST_NOW, putBid = 0.6, putAsk = putBid + 0.02): VenueOptionChain {
  return {
    venue: 'deribit',
    underlying: 'BTC',
    expiry: TEST_EXPIRY,
    asOf: now,
    contracts: { put: contract('put', now, putBid, putAsk), call: contract('call', now) },
  };
}
