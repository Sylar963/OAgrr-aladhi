import { describe, expect, it } from 'vitest';
import type { AlphaMarketContextResponse } from '@oggregator/protocol';
import { black76Price } from '@lib/analytics/blackScholes';
import { comparePremiums, premiumReference, premiumState, premiumTone } from './premium-comparison';
import { input, now } from './spread-scan.fixtures';
import { scanSpreads } from './spread-scanner';
import { expiryPnl } from './vertical-pricing';

function fixture(kind = 'call-debit', sigma = 0.8) {
  const i = input();
  const context = {
    generatedAt: now,
    underlying: 'BTC',
    automatic: {
      horizonSource: 'selected-expiry',
      horizonDays: 7,
      pricing: { forecastVol: sigma },
    },
  } as AlphaMarketContextResponse;
  const candidate = scanSpreads(i)[0]!.candidates.find((c) => c.kind === kind)!;
  const route = { buyVenue: 'thalex', sellVenue: 'thalex' } as const;
  const compare = () => comparePremiums(candidate, route, i.chain, context, now);
  return { i, candidate, context, route, compare };
}

describe('dollar premium comparison', () => {
  it.each([
    'call-credit',
    'put-credit',
    'call-debit',
    'put-debit',
  ])('prices %s at selected size with actual fees and the matched reference', (kind) => {
    const f = fixture(kind);
    const v = f.compare();
    expect(v.unavailable).toBeNull();
    if (v.unavailable) return;
    const c = f.candidate;
    const right = kind.startsWith('call') ? 'call' : 'put';
    const buy = c.quantity * black76Price(right, 80000, c.buyStrike, 7 / 365.25, 0.8);
    const sell = c.quantity * black76Price(right, 80000, c.sellStrike, 7 / 365.25, 0.8);
    expect(v.spreadReference).toBeCloseTo(kind.endsWith('debit') ? buy - sell : sell - buy);
    expect(v.spreadAdvantage).toBeCloseTo(c.grossPremium - c.entryFee - c.costReserve + buy - sell);
    expect(v.buyCost).toBeCloseTo(
      kind.startsWith('call')
        ? kind.endsWith('debit')
          ? 11.37
          : 7.37
        : kind.endsWith('debit')
          ? 15.37
          : 11.37,
    );
    expect(v.alternative?.right).toBe(
      kind.endsWith('debit') ? right : right === 'call' ? 'put' : 'call',
    );
  });

  it.each([
    'call-debit',
    'put-debit',
  ])('calculates the actual cost saving and expiry crossover for %s', (kind) => {
    const f = fixture(kind);
    const v = f.compare();
    if (v.unavailable || !v.alternative || v.crossover == null) throw Error('Missing comparison');
    expect(v.savings).toBeCloseTo(v.alternative.cost - f.candidate.maxLoss);
    const intrinsic = kind.startsWith('call')
      ? Math.max(v.crossover - v.alternative.strike, 0)
      : Math.max(v.alternative.strike - v.crossover, 0);
    const outrightPnl = f.candidate.quantity * intrinsic - v.alternative.cost;
    expect(expiryPnl(f.candidate, v.crossover)).toBeCloseTo(outrightPnl);
  });

  it('does not call a credit rich merely because the short leg is rich', () => {
    const f = fixture('call-credit', 0.1);
    const v = f.compare();
    if (v.unavailable) throw Error('Missing comparison');
    expect(v.sellRichness).toBeGreaterThan(0);
    expect(v.spreadAdvantage).toBeLessThan(0);
    expect(v.pricingTone).toBe('bad');
  });

  it('does not equate a cheap long leg with a cheap vertical', () => {
    const v = fixture('call-debit', 1.5).compare();
    if (v.unavailable) throw Error('Missing comparison');
    expect(v.buySaving).toBeGreaterThan(0);
    expect(v.spreadAdvantage).toBeLessThan(0);
    expect(v.pricingTone).toBe('bad');
  });

  it.each([
    'stale-reference',
    'wrong-expiry',
    'wrong-asset',
    'scan-reference',
    'no-forecast',
    'stale-quotes',
    'inverse',
    'missing-fee',
    'cross-venue',
  ] as const)('withholds misleading values for %s', (failure) => {
    const f = fixture();
    if (failure === 'stale-reference') f.context.generatedAt -= 121_000;
    if (failure === 'wrong-expiry') f.context.automatic!.horizonDays = 30;
    if (failure === 'wrong-asset') f.context.underlying = 'ETH';
    if (failure === 'scan-reference') f.context.automatic!.horizonSource = 'scan-reference';
    if (failure === 'no-forecast') f.context.automatic!.pricing.forecastVol = null;
    if (failure === 'stale-quotes') f.i.chain.strikes[0]!.call.venues.thalex!.asOfMs = now - 16000;
    if (failure === 'inverse') f.i.chain.strikes[0]!.call.venues.thalex!.execution!.inverse = true;
    if (failure === 'missing-fee')
      f.i.chain.strikes[0]!.call.venues.thalex!.execution!.askTakerFeeUsd = null;
    const route = failure === 'cross-venue' ? { ...f.route, sellVenue: 'okx' as const } : f.route;
    expect(comparePremiums(f.candidate, route, f.i.chain, f.context, now).unavailable).toBeTruthy();
  });

  it('separates normal insurance premium from unusual richness and withholds missing history', () => {
    const { context } = fixture();
    context.automatic!.pricing.atmIv = 0.4;
    context.automatic!.pricing.forecastVol = 0.3;
    context.richness = {
      fairBand: 0.02,
      tenors: {
        '7d': { premiumBaseline: { medianSpread: 0.1 } },
        '30d': { premiumBaseline: { medianSpread: null } },
      },
    } as NonNullable<AlphaMarketContextResponse['richness']>;
    const ref = premiumReference(context);
    expect(premiumState(ref.spread)).toBe('rich');
    expect(premiumState(ref.excess)).toBe('fair');
    context.automatic!.horizonDays = 17;
    expect(premiumReference(context).excess).toBeNull();
  });

  it('requires unusual carry premium and resolved stress before a credit price check turns green', () => {
    const f = fixture('call-credit', 0.01);
    f.context.automatic!.pricing.atmIv = 0.4;
    let value = f.compare();
    if (value.unavailable) throw Error('Missing comparison');
    expect(value.spreadAdvantage).toBeGreaterThan(0);
    expect(value.sellRichness).toBeGreaterThan(0);
    expect(value.pricingTone).toBe('watch');
    f.context.richness = {
      fairBand: 0.02,
      tenors: { '7d': { premiumBaseline: { medianSpread: 0.1 } } },
    } as NonNullable<AlphaMarketContextResponse['richness']>;
    f.context.automatic!.stress = {
      rv7d: 0.01,
      rv30d: 0.01,
      accelerationRatio: 1,
      accelerationPercentile: 50,
      backwardation: false,
      accelerating: false,
    };
    value = f.compare();
    if (value.unavailable) throw Error('Missing comparison');
    expect(value.pricingTone).toBe('good');
    f.context.automatic!.stress.accelerating = true;
    value = f.compare();
    if (value.unavailable) throw Error('Missing comparison');
    expect(value.pricingTone).toBe('watch');
    f.context.automatic!.stress.accelerating = false;
    f.context.richness.tenors['7d'].premiumBaseline.medianSpread = 0.39;
    value = f.compare();
    if (value.unavailable) throw Error('Missing comparison');
    expect(value.pricingTone).toBe('watch');
  });

  it('keeps actual high-IV cheapness distinct from raw IV level', () => {
    expect(premiumState(0.8 - 1)).toBe('cheap');
    expect(premiumTone('cheap', false)).toBe('good');
    expect(premiumTone('cheap', true)).toBe('bad');
    expect(premiumTone('unavailable', true)).toBe('unknown');
  });
});
