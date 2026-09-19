import { VENUES } from '@lib/venue-meta';
import type { VenueId } from '@shared/enriched';
import { useState } from 'react';
import { z } from 'zod';
import styles from './SpreadBuilderPanel.module.css';

export interface AlphaSizing {
  equity: string;
  quantity: string;
  riskPct: string;
  reserve: string;
}

const defaults: AlphaSizing = { equity: '', quantity: '0.01', riskPct: '1', reserve: '0.25' };
const sizingSchema = z.object({
  equity: z.string(),
  quantity: z.string(),
  riskPct: z.string(),
  reserve: z.string(),
});

export function useAlphaSizing() {
  const [sizing, setSizing] = useState<AlphaSizing>(() => {
    try {
      const stored = sizingSchema.safeParse(
        JSON.parse(localStorage.getItem('alpha-sizing-v1') ?? 'null'),
      );
      if (stored.success) return stored.data;
    } catch {}
    return defaults;
  });
  function update(key: keyof AlphaSizing, value: string) {
    setSizing((previous) => {
      const next = { ...previous, [key]: value };
      try {
        localStorage.setItem('alpha-sizing-v1', JSON.stringify(next));
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
}: {
  sizing: AlphaSizing;
  update: (key: keyof AlphaSizing, value: string) => void;
  venue: VenueId;
  venues: readonly VenueId[];
  onVenue: (venue: VenueId) => void;
  underlying: string;
}) {
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
          ['quantity', 'Quantity · ' + underlying + ' per leg', '0.01'],
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
