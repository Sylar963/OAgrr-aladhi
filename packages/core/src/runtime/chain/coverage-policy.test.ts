import { describe, expect, it } from 'vitest';
import {
  HOT_CHAIN_EXPIRY_COUNT,
  WARM_CHAIN_EXPIRY_COUNT,
  baseChainCoverageTier,
  chainCoverageTierForRequest,
  listChainWarmupTargets,
} from './coverage-policy.js';

describe('chain coverage policy', () => {
  it('classifies static hot, warm, and cold underlyings', () => {
    expect(baseChainCoverageTier('BTC')).toBe('hot');
    expect(baseChainCoverageTier('XRP_USDC')).toBe('warm');
    expect(baseChainCoverageTier('LTC')).toBe('cold');
  });

  it('promotes an in-use request to active regardless of base tier', () => {
    expect(chainCoverageTierForRequest({ underlying: 'BTC' }, 1)).toBe('active');
    expect(chainCoverageTierForRequest({ underlying: 'LTC' }, 2)).toBe('active');
    expect(chainCoverageTierForRequest({ underlying: 'LTC' }, 0)).toBe('cold');
  });

  it('emits the shared warmup target list with configured expiry counts', () => {
    expect(listChainWarmupTargets()).toEqual([
      { tier: 'hot', underlying: 'BTC', expiryCount: HOT_CHAIN_EXPIRY_COUNT },
      { tier: 'hot', underlying: 'ETH', expiryCount: HOT_CHAIN_EXPIRY_COUNT },
      { tier: 'hot', underlying: 'BTC_USDC', expiryCount: HOT_CHAIN_EXPIRY_COUNT },
      { tier: 'hot', underlying: 'ETH_USDC', expiryCount: HOT_CHAIN_EXPIRY_COUNT },
      { tier: 'hot', underlying: 'SOL_USDC', expiryCount: HOT_CHAIN_EXPIRY_COUNT },
      { tier: 'warm', underlying: 'AVAX_USDC', expiryCount: WARM_CHAIN_EXPIRY_COUNT },
      { tier: 'warm', underlying: 'XRP_USDC', expiryCount: WARM_CHAIN_EXPIRY_COUNT },
      { tier: 'warm', underlying: 'TRX_USDC', expiryCount: WARM_CHAIN_EXPIRY_COUNT },
    ]);
  });
});
