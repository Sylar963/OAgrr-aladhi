import { describe, expect, it } from 'vitest';
import { PremiumSpikeSampleSchema } from './premium-spikes.js';

const oldSample = {
  observedAt: 1000,
  quoteAt: 1000,
  putIv: { bid: 0.6, ask: 0.62 },
  callIv: { bid: 0.5, ask: 0.52 },
  putSkew: { bid: 0.08, ask: 0.12 },
  callSkew: { bid: -0.12, ask: -0.08 },
};

describe('premium spike money compatibility', () => {
  it('keeps old persisted observations valid and leaves historical dollars explicitly unavailable', () => {
    const parsed = PremiumSpikeSampleSchema.parse(oldSample);
    expect(parsed.money).toBeNull();
    expect(parsed.putSkew).toEqual(oldSample.putSkew);
  });
  it('allows independently missing index and normalized premiums', () => {
    expect(
      PremiumSpikeSampleSchema.parse({
        ...oldSample,
        money: {
          referencePriceUsd: null,
          putPremiumUsdPerBase: null,
          callPremiumUsdPerBase: { bid: 100, ask: 110 },
        },
      }).money!.callPremiumUsdPerBase,
    ).toEqual({ bid: 100, ask: 110 });
  });
  it.each([
    { referencePriceUsd: -1, putPremiumUsdPerBase: null, callPremiumUsdPerBase: null },
    {
      referencePriceUsd: 100000,
      putPremiumUsdPerBase: { bid: 200, ask: 100 },
      callPremiumUsdPerBase: null,
    },
    {
      referencePriceUsd: 100000,
      putPremiumUsdPerBase: { bid: 100, ask: Infinity },
      callPremiumUsdPerBase: null,
    },
  ])('rejects invalid or crossed dollar observations', (money) => {
    expect(PremiumSpikeSampleSchema.safeParse({ ...oldSample, money }).success).toBe(false);
  });
});
