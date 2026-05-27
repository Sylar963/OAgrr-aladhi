import type { WsSubscriptionRequest } from '../../core/types.js';

export type ChainCoverageTier = 'hot' | 'warm' | 'active' | 'cold';

export interface ChainWarmupTarget {
  tier: 'hot' | 'warm';
  underlying: string;
  expiryCount: number;
}

export const HOT_CHAIN_UNDERLYINGS = ['BTC', 'ETH', 'BTC_USDC', 'ETH_USDC', 'SOL_USDC'] as const;
export const WARM_CHAIN_UNDERLYINGS = ['AVAX_USDC', 'XRP_USDC', 'TRX_USDC'] as const;

export const HOT_CHAIN_EXPIRY_COUNT = 4;
export const WARM_CHAIN_EXPIRY_COUNT = 2;

const HOT_CHAIN_UNDERLYING_SET = new Set<string>(HOT_CHAIN_UNDERLYINGS);
const WARM_CHAIN_UNDERLYING_SET = new Set<string>(WARM_CHAIN_UNDERLYINGS);

export function baseChainCoverageTier(underlying: string): Exclude<ChainCoverageTier, 'active'> {
  if (HOT_CHAIN_UNDERLYING_SET.has(underlying)) return 'hot';
  if (WARM_CHAIN_UNDERLYING_SET.has(underlying)) return 'warm';
  return 'cold';
}

export function chainCoverageTierForRequest(
  request: Pick<WsSubscriptionRequest, 'underlying'>,
  activeRefCount: number,
): ChainCoverageTier {
  if (activeRefCount > 0) return 'active';
  return baseChainCoverageTier(request.underlying);
}

export function listChainWarmupTargets(): ChainWarmupTarget[] {
  return [
    ...HOT_CHAIN_UNDERLYINGS.map((underlying) => ({
      tier: 'hot' as const,
      underlying,
      expiryCount: HOT_CHAIN_EXPIRY_COUNT,
    })),
    ...WARM_CHAIN_UNDERLYINGS.map((underlying) => ({
      tier: 'warm' as const,
      underlying,
      expiryCount: WARM_CHAIN_EXPIRY_COUNT,
    })),
  ];
}
