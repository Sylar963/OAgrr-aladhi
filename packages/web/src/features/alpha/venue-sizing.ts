import type { EnrichedChainResponse, VenueId } from '@shared/enriched';
import { scanSpreads } from './spread-scanner';

export interface VenueSizeRule {
  min: number;
  step: number;
}

/** Largest min size and step the venue quotes on this chain, so any pair of its strikes clears both. */
export function venueSizeRule(
  chain: EnrichedChainResponse | undefined,
  venue: VenueId,
): VenueSizeRule | null {
  let min = 0;
  let step = 0;
  for (const strike of chain?.strikes ?? []) {
    for (const side of [strike.call, strike.put]) {
      const execution = side?.venues[venue]?.execution;
      if (!execution) continue;
      min = Math.max(min, execution.minQuantity);
      step = Math.max(step, execution.quantityStep);
    }
  }
  return Number.isFinite(min) && min > 0 && Number.isFinite(step) && step > 0
    ? { min, step }
    : null;
}

export function formatQuantity(value: number): string {
  return String(Number(value.toPrecision(10)));
}

export function chainSpotUsd(chain: EnrichedChainResponse | undefined): number | null {
  return chain?.stats.indexPriceUsd ?? chain?.stats.forwardPriceUsd ?? null;
}

// A venue minimum can be ~$1 of notional (Binance 0.01 SOL), too small to clear the fixed
// USD cost reserve; on live SOL/XRP/DOGE chains this floor never priced fewer pairs.
const DEFAULT_NOTIONAL_USD = 100;

function quantityForNotional(rule: VenueSizeRule, spotUsd: number, notionalUsd: number): number {
  const steps = Math.ceil(notionalUsd / spotUsd / rule.step - 1e-9);
  return Math.max(rule.min, Number((steps * rule.step).toPrecision(10)));
}

/** Default size for an underlying: about $100 of notional, rounded up onto the venue's step. */
export function defaultQuantity(rule: VenueSizeRule, spotUsd: number | null | undefined): number {
  if (spotUsd == null || !Number.isFinite(spotUsd) || spotUsd <= 0) return rule.min;
  return quantityForNotional(rule, spotUsd, DEFAULT_NOTIONAL_USD);
}

// Venues bound executable size from both sides: a minimum order value per leg (Paradex
// $20 at mark) pushes size up, thin displayed books (Paradex median 0.01 BTC) cap it.
// Where that window sits differs per venue, underlying and expiry, so it is probed.
const SIZE_LADDER_USD = [100, 250, 500, 1_000, 2_500, 5_000] as const;
// Live chains gained a few percent more pairs at 20–50× the size (ETH 2098→2216 pairs at
// $5k vs $100); the default should only grow size when the book demands it.
const SUFFICIENT_PAIR_SHARE = 0.8;

export interface VenueQuantitySuggestion {
  quantity: number;
  pairs: number;
}

/**
 * Smallest size on the ladder at which `venue` prices at least 80% of the most spreads any
 * rung prices on this chain. With no executable pair at any rung it falls back to
 * `defaultQuantity`.
 */
export function suggestVenueQuantity(
  chain: EnrichedChainResponse,
  venue: VenueId,
  costReserve: number,
  nowMs: number,
): VenueQuantitySuggestion | null {
  const rule = venueSizeRule(chain, venue);
  if (rule == null) return null;
  const spot = chainSpotUsd(chain);
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return { quantity: rule.min, pairs: 0 };

  const ladder = [...new Set(SIZE_LADDER_USD.map((usd) => quantityForNotional(rule, spot, usd)))];
  const rungs: VenueQuantitySuggestion[] = [];
  for (const quantity of ladder) {
    // Budget limits only change a pair's status, not whether it is priced; size is probed alone.
    const scan = scanSpreads({
      chain,
      venues: [venue],
      quantity,
      equity: Number.MAX_SAFE_INTEGER,
      riskPct: 100,
      costReserve,
      nowMs,
    })[0];
    rungs.push({ quantity, pairs: scan?.candidates.length ?? 0 });
  }
  const most = Math.max(0, ...rungs.map((rung) => rung.pairs));
  if (most === 0) return { quantity: defaultQuantity(rule, spot), pairs: 0 };
  return rungs.find((rung) => rung.pairs >= most * SUFFICIENT_PAIR_SHARE) ?? rungs[0]!;
}
