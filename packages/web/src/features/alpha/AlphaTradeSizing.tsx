import { VENUES } from '@lib/venue-meta';
import type { EnrichedChainResponse, VenueId } from '@shared/enriched';
import { useState } from 'react';
import { z } from 'zod';
import styles from './SpreadBuilderPanel.module.css';
import type { AlphaMarket } from './useAlphaMarketData';

export interface AlphaSizing {
  equity: string;
  quantity: string;
  riskPct: string;
  reserve: string;
}

const SIZING: Record<
  AlphaMarket,
  { storageKey: string; defaults: AlphaSizing; unit: (underlying: string) => string }
> = {
  crypto: {
    storageKey: 'alpha-sizing-v1',
    defaults: { equity: '', quantity: '0.01', riskPct: '1', reserve: '0.25' },
    unit: (underlying) => underlying,
  },
  tradfi: {
    storageKey: 'alpha-sizing-tradfi-v1',
    defaults: { equity: '', quantity: '100', riskPct: '1', reserve: '0.25' },
    unit: (underlying) => `${underlying} shares (100 = 1 contract)`,
  },
};
const sizingSchema = z.object({
  equity: z.string(),
  quantity: z.string(),
  riskPct: z.string(),
  reserve: z.string(),
  quantities: z.record(z.string(), z.string()).optional(),
});
type StoredSizing = AlphaSizing & { quantities: Record<string, string> };

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

// A venue minimum can be ~$1 of notional (Binance 0.01 SOL), too small to clear the fixed
// USD cost reserve; on live SOL/XRP/DOGE chains this floor never priced fewer pairs.
const DEFAULT_NOTIONAL_USD = 100;

/** Default size for an underlying: about $100 of notional, rounded up onto the venue's step. */
export function defaultQuantity(rule: VenueSizeRule, spotUsd: number | null | undefined): number {
  if (spotUsd == null || !Number.isFinite(spotUsd) || spotUsd <= 0) return rule.min;
  const steps = Math.ceil(DEFAULT_NOTIONAL_USD / spotUsd / rule.step - 1e-9);
  return Math.max(rule.min, Number((steps * rule.step).toPrecision(10)));
}

function loadSizing(market: AlphaMarket): StoredSizing {
  const { storageKey, defaults } = SIZING[market];
  try {
    const stored = sizingSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
    if (stored.success) {
      const { quantities, ...rest } = stored.data;
      // v1 kept one quantity for every ticker; it was sized for BTC/ETH, so it only carries over there.
      const legacy =
        quantities ?? (market === 'crypto' ? { BTC: rest.quantity, ETH: rest.quantity } : {});
      return { ...rest, quantities: legacy };
    }
  } catch {}
  return { ...defaults, quantities: {} };
}

/**
 * Equity, risk and reserve are account-wide; quantity is per underlying because coin units
 * differ by orders of magnitude (0.01 BTC vs 1 SOL vs 100 DOGE). Until the user sets one,
 * the quantity follows `autoQuantity`, derived from the trade venue's size rule.
 */
export function useAlphaSizing(
  market: AlphaMarket,
  underlying: string,
  autoQuantity: string | null,
) {
  const { storageKey, defaults } = SIZING[market];
  const [stored, setStored] = useState<StoredSizing>(() => loadSizing(market));
  const fallback = market === 'tradfi' ? stored.quantity : defaults.quantity;
  const sizing: AlphaSizing = {
    equity: stored.equity,
    riskPct: stored.riskPct,
    reserve: stored.reserve,
    quantity: stored.quantities[underlying] ?? autoQuantity ?? fallback,
  };
  function update(key: keyof AlphaSizing, value: string) {
    setStored((previous) => {
      const next =
        key === 'quantity'
          ? { ...previous, quantities: { ...previous.quantities, [underlying]: value } }
          : { ...previous, [key]: value };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  return { sizing, update };
}

export default function AlphaTradeSizing({
  sizing,
  update,
  venue,
  venues,
  onVenue,
  underlying,
  market,
  sizeRule,
}: {
  sizing: AlphaSizing;
  update: (key: keyof AlphaSizing, value: string) => void;
  venue: VenueId;
  venues: readonly VenueId[];
  onVenue: (venue: VenueId) => void;
  underlying: string;
  market: AlphaMarket;
  sizeRule: VenueSizeRule | null;
}) {
  const { defaults, unit } = SIZING[market];
  const quantity = Number(sizing.quantity);
  const offRule =
    sizeRule != null &&
    Number.isFinite(quantity) &&
    (quantity < sizeRule.min ||
      Math.abs(quantity / sizeRule.step - Math.round(quantity / sizeRule.step)) > 1e-7);
  return (
    <div className={styles.block}>
      <div className={styles.label}>Your trade size</div>
      <label className={styles.hint}>
        Trade venue
        <select
          className={styles.select}
          value={venue}
          onChange={(e) => onVenue(e.target.value as VenueId)}
        >
          {venues.map((v) => (
            <option key={v} value={v}>
              {VENUES[v]?.label ?? v}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ['equity', 'Account equity · USD', '1080'],
          ['quantity', `Quantity · ${unit(underlying)} per leg`, defaults.quantity],
          ['riskPct', 'Max loss budget · % of equity', '1'],
          ['reserve', 'Exit / settlement / slippage reserve · USD', '0.25'],
        ] as const
      ).map(([key, label, placeholder]) => (
        <label key={key} className={styles.hint}>
          {label}
          <input
            className={styles.select}
            type="number"
            min="0"
            step="any"
            placeholder={placeholder}
            value={sizing[key]}
            onChange={(e) => update(key, e.target.value)}
          />
          {key === 'quantity' && sizeRule != null && (
            <span data-invalid={offRule || undefined}>
              {VENUES[venue]?.label ?? venue} minimum {formatQuantity(sizeRule.min)} · step{' '}
              {formatQuantity(sizeRule.step)}
              {offRule && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className={styles.inlineAction}
                    onClick={() => update('quantity', formatQuantity(sizeRule.min))}
                  >
                    Use {formatQuantity(sizeRule.min)}
                  </button>
                </>
              )}
            </span>
          )}
        </label>
      ))}
      <p className={styles.hint}>
        Equity is manual, not your live balance. 1% and $0.25 are editable planning examples, not
        recommended limits or verified costs. Check free margin on the venue.
      </p>
    </div>
  );
}
