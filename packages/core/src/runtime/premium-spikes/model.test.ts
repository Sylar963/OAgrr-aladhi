import { describe, expect, it } from 'vitest';
import { chain, contract, TEST_NOW, TEST_EXPIRY_TS } from './fixtures.js';
import { premiumSpikeSample, premiumSpikeSession, selectPremiumSpikeExpiries } from './model.js';

describe('Pacific skew sessions', () => {
  it.each([
    ['2026-11-20T07:59:59Z', '2026-11-19T08:00:00Z', '2026-11-20T08:00:00Z'],
    ['2026-11-20T08:00:00Z', '2026-11-20T08:00:00Z', '2026-11-21T08:00:00Z'],
    ['2026-03-08T20:00:00Z', '2026-03-08T08:00:00Z', '2026-03-09T07:00:00Z'],
    ['2026-11-01T20:00:00Z', '2026-11-01T07:00:00Z', '2026-11-02T08:00:00Z'],
  ])('handles midnight and DST at %s', (now, start, end) => {
    expect(premiumSpikeSession(Date.parse(now))).toEqual({
      start: Date.parse(start),
      end: Date.parse(end),
    });
  });
  it('selects the closest actual future expiries and permits shared fallback expiries', () => {
    const rows = selectPremiumSpikeExpiries(
      [
        { expiry: '2026-11-19', expiryTs: null },
        ...[32, 88, 185, 350].map((days) => ({
          expiry: String(days),
          expiryTs: TEST_NOW + days * 86_400_000,
        })),
      ],
      TEST_NOW,
    );
    expect(rows.map((row) => row.expiry)).toEqual(['32', '88', '185', '350']);
    expect(selectPremiumSpikeExpiries([], TEST_NOW).every((row) => row.expiry === null)).toBe(true);
    expect(
      selectPremiumSpikeExpiries([{ expiry: '2026-12-20', expiryTs: null }], TEST_NOW).map(
        (row) => row.expiry,
      ),
    ).toEqual(Array(4).fill('2026-12-20'));
  });
});

describe('matched 25-delta skew quote', () => {
  it('uses opposite bid/ask legs and preserves the reciprocal signs', () => {
    const sample = premiumSpikeSample(chain(), TEST_EXPIRY_TS, TEST_NOW)!;
    expect(sample.putSkew.bid).toBeCloseTo(0.08);
    expect(sample.putSkew.ask).toBeCloseTo(0.12);
    expect(sample.callSkew.bid).toBeCloseTo(-sample.putSkew.ask);
    expect(sample.callSkew.ask).toBeCloseTo(-sample.putSkew.bid);
  });
  it('interpolates both rights to exactly matching absolute delta', () => {
    const input = chain();
    input.contracts = {};
    for (const right of ['put', 'call'] as const) {
      for (const delta of [0.2, 0.3]) {
        const c = contract(right, TEST_NOW, (right === 'put' ? 0.4 : 0.3) + delta);
        c.greeks.delta = delta * (right === 'put' ? -1 : 1);
        input.contracts[`${right}${delta}`] = c;
      }
    }
    const sample = premiumSpikeSample(input, TEST_EXPIRY_TS, TEST_NOW)!;
    expect(sample.putIv.bid).toBeCloseTo(0.65);
    expect(sample.callIv.bid).toBeCloseTo(0.55);
  });
  it.each([
    'invalid-time',
    'stale',
    'future',
    'one-sided',
    'crossed-price',
    'crossed-iv',
    'no-size',
    'nan',
    'wrong-settlement',
    'wrong-delta-sign',
    'out-of-sync',
  ])('rejects %s input', (kind) => {
    const input = chain();
    const put = input.contracts.put!;
    if (kind === 'invalid-time') put.quote.timestamp = NaN;
    if (kind === 'stale') put.quote.timestamp = TEST_NOW - 60_001;
    if (kind === 'future') put.quote.timestamp = TEST_NOW + 1;
    if (kind === 'one-sided') put.greeks.askIv = null;
    if (kind === 'crossed-price') put.quote.ask.usd = 999;
    if (kind === 'crossed-iv') put.greeks.askIv = 0.59;
    if (kind === 'no-size') put.quote.bidSize = 0;
    if (kind === 'nan') put.greeks.bidIv = NaN;
    if (kind === 'wrong-settlement') put.expiryTs = TEST_EXPIRY_TS + 1;
    if (kind === 'wrong-delta-sign') put.greeks.delta = 0.25;
    if (kind === 'out-of-sync') put.quote.timestamp = TEST_NOW - 15_001;
    expect(premiumSpikeSample(input, TEST_EXPIRY_TS, TEST_NOW)).toBeNull();
  });
  it('never extrapolates from a nearby strike or uses a distant delta bracket', () => {
    const input = chain();
    input.contracts.put!.greeks.delta = -0.24;
    expect(premiumSpikeSample(input, TEST_EXPIRY_TS, TEST_NOW)).toBeNull();
    const far = contract('put');
    far.greeks.delta = -0.4;
    input.contracts.far = far;
    expect(premiumSpikeSample(input, TEST_EXPIRY_TS, TEST_NOW)).toBeNull();
  });
});

describe('skew quote dollar context', () => {
  it('uses normalized per-base premiums without multiplying or dividing by contract size again', () => {
    const input = chain();
    input.contracts.put!.contractMultiplierBase = 0.01;
    input.contracts.put!.contractSize = 0.01;
    input.contracts.put!.quote.bid.usd = 10;
    input.contracts.put!.quote.ask.usd = 11;
    const sample = premiumSpikeSample(input, TEST_EXPIRY_TS, TEST_NOW)!;
    expect(sample.money).toEqual({
      referencePriceUsd: 100000,
      putPremiumUsdPerBase: { bid: 1000, ask: 1100 },
      callPremiumUsdPerBase: { bid: 1000, ask: 1100 },
    });
  });
  it('interpolates USD premium with the same delta weights as IV and uses only supporting index observations', () => {
    const input = chain();
    const low = contract('put');
    low.greeks.delta = -0.2;
    low.quote.bid.usdPerBase = 1000;
    low.quote.ask.usdPerBase = 1200;
    low.quote.indexPriceUsd = 99000;
    const high = contract('put');
    high.greeks.delta = -0.3;
    high.quote.bid.usdPerBase = 2000;
    high.quote.ask.usdPerBase = 2400;
    high.quote.indexPriceUsd = 105000;
    input.contracts = { low, high, call: contract('call') };
    const sample = premiumSpikeSample(input, TEST_EXPIRY_TS, TEST_NOW)!;
    expect(sample.money!.referencePriceUsd).toBe(100000);
    expect(sample.money!.putPremiumUsdPerBase!.bid).toBeCloseTo(1500);
    expect(sample.money!.putPremiumUsdPerBase!.ask).toBeCloseTo(1800);
    expect(sample.putSkew.bid).toBeCloseTo(0.08);
  });
  it.each([
    'missing-normalization',
    'crossed-normalization',
    'invalid-normalization',
    'missing-index',
    'invalid-index',
  ])('withholds %s money without suppressing a valid IV observation or inventing a conversion', (kind) => {
    const input = chain();
    const quote = input.contracts.put!.quote;
    if (kind === 'missing-normalization') delete quote.bid.usdPerBase;
    if (kind === 'crossed-normalization') quote.bid.usdPerBase = 1200;
    if (kind === 'invalid-normalization') quote.ask.usdPerBase = Infinity;
    if (kind === 'missing-index') quote.indexPriceUsd = null;
    if (kind === 'invalid-index') quote.indexPriceUsd = NaN;
    const sample = premiumSpikeSample(input, TEST_EXPIRY_TS, TEST_NOW)!;
    expect(sample.putSkew.bid).toBeCloseTo(0.08);
    if (kind.endsWith('normalization')) expect(sample.money!.putPremiumUsdPerBase).toBeNull();
    else {
      expect(sample.money!.referencePriceUsd).toBeNull();
      expect(sample.money!.putPremiumUsdPerBase).toEqual({ bid: 1000, ask: 1100 });
    }
  });
});
