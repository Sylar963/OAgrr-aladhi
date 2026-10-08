import { VENUES } from '@lib/venue-meta';
import type { VenueId } from '@shared/enriched';
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
});

export function useAlphaSizing(market: AlphaMarket) {
  const { storageKey, defaults } = SIZING[market];
  const [sizing, setSizing] = useState<AlphaSizing>(() => {
    try {
      const stored = sizingSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));
      if (stored.success) return stored.data;
    } catch {}
    return defaults;
  });
  function update(key: keyof AlphaSizing, value: string) {
    setSizing((previous) => {
      const next = { ...previous, [key]: value };
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
}: {
  sizing: AlphaSizing;
  update: (key: keyof AlphaSizing, value: string) => void;
  venue: VenueId;
  venues: readonly VenueId[];
  onVenue: (venue: VenueId) => void;
  underlying: string;
  market: AlphaMarket;
}) {
  const { defaults, unit } = SIZING[market];
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
        </label>
      ))}
      <p className={styles.hint}>
        Equity is manual, not your live balance. 1% and $0.25 are editable planning examples, not
        recommended limits or verified costs. Check free margin on the venue.
      </p>
    </div>
  );
}
