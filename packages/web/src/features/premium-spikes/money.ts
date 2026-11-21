import type { PremiumSpikeSample } from '@oggregator/protocol';

export function premiumSpikeSize(input: string): number | null {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 && value <= 1_000_000 ? value : null;
}
function amount(value: number | null | undefined, size: number | null): number | null {
  if (value == null || size == null) return null;
  const total = value * size;
  return Number.isFinite(total) && total > 0 ? total : null;
}
export function premiumSpikeNotional(
  sample: PremiumSpikeSample | null,
  size: number | null,
): number | null {
  return amount(sample?.money?.referencePriceUsd, size);
}
export function premiumSpikePremium(
  sample: PremiumSpikeSample | null,
  side: 'put' | 'call',
  size: number | null,
): { bid: number; ask: number } | null {
  const pair =
    side === 'put' ? sample?.money?.putPremiumUsdPerBase : sample?.money?.callPremiumUsdPerBase;
  const bid = amount(pair?.bid, size);
  const ask = amount(pair?.ask, size);
  return bid == null || ask == null ? null : { bid, ask };
}
